"use server";

import {
  SupportTicket,
  TicketCategory,
  TicketDepartment,
  TicketPriority,
  TicketStatus,
  TicketFilters,
  TicketLog,
  TicketReply,
} from "@/types/support";
import { requireClient, requireAdmin, requireAuth } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function getAdmin() {
  return createAdminClient() as any;
}

function mapRowToTicket(row: any, isClientUser: boolean = false): SupportTicket {
  const messages = (row.ticket_messages || [])
    .filter((msg: any) => !isClientUser || !msg.is_internal)
    .map((msg: any) => ({
      id: msg.id,
      ticketId: msg.ticket_id,
      senderId: msg.sender_id,
      authorName: msg.sender_name || msg.profiles?.full_name || "Support",
      authorRole: (msg.sender_role as any) || "client",
      content: msg.message,
      isInternal: Boolean(msg.is_internal),
      attachments: msg.attachments || [],
      createdAt: msg.created_at,
    }));

  return {
    id: row.id,
    ticketNumber: row.ticket_number,
    clientId: row.client_id,
    companyName: row.clients?.company_name || "Organization",
    clientName: row.clients?.full_name || "Client",
    clientEmail: row.clients?.primary_email || "client@nexusos.io",
    serviceId: row.service_id || undefined,
    serviceName: row.services?.custom_name || undefined,
    subject: row.subject,
    description: row.description || "",
    category: (row.category as TicketCategory) || "general",
    department: (row.department as TicketDepartment) || (row.category as TicketDepartment) || "general",
    priority: (row.priority as TicketPriority) || "medium",
    status: (row.status as TicketStatus) || "open",
    assignedToId: row.assigned_to || undefined,
    assignedTo: row.assigned_to_profile?.full_name || undefined,
    replies: messages,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at || undefined,
    closedAt: row.closed_at || undefined,
  };
}

export async function getSupportTicketsAction(filters: TicketFilters = {}) {
  const user = await requireAuth();
  const supabase = user.role === "admin" ? getAdmin() : await createServerSupabaseClient() as any;

  let query = supabase
    .from("support_tickets")
    .select(`
      *,
      clients (id, primary_email, company_name, full_name),
      services (id, custom_name),
      ticket_messages (*)
    `)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (user.role === "client") {
    const { data: clientRec } = await supabase
      .from("clients")
      .select("id")
      .eq("profile_id", user.id)
      .limit(1)
      .maybeSingle();

    if (clientRec) {
      query = query.eq("client_id", clientRec.id);
    } else {
      query = query.eq("created_by", user.id);
    }
  } else if (filters.clientId) {
    query = query.eq("client_id", filters.clientId);
  }

  if (filters.department && filters.department !== "all") {
    query = query.or(`department.eq.${filters.department},category.eq.${filters.department}`);
  }

  if (filters.priority && filters.priority !== "all") {
    query = query.eq("priority", filters.priority);
  }

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  const { data, error } = await query;

  if (error) {
    return { success: false, error: `Database error: ${error.message}` };
  }

  const isClient = user.role === "client";
  let result: SupportTicket[] = (data || []).map((row: any) => mapRowToTicket(row, isClient));

  if (filters.search && filters.search.trim() !== "") {
    const q = filters.search.toLowerCase().trim();
    result = result.filter(
      (t) =>
        t.ticketNumber.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        (t.companyName && t.companyName.toLowerCase().includes(q)) ||
        (t.serviceName && t.serviceName.toLowerCase().includes(q))
    );
  }

  return { success: true, data: { tickets: result } };
}

export async function getTicketDetailsAction(ticketId: string) {
  const user = await requireAuth();
  const supabase = user.role === "admin" ? getAdmin() : await createServerSupabaseClient() as any;

  const { data: row, error } = await supabase
    .from("support_tickets")
    .select(`
      *,
      clients (id, primary_email, company_name, full_name, phone),
      services (id, custom_name, service_status, renewal_date),
      ticket_messages (*)
    `)
    .eq("id", ticketId)
    .single();

  if (error || !row) {
    return { success: false, error: "Support ticket record not found." };
  }

  const isClient = user.role === "client";
  const ticket = mapRowToTicket(row, isClient);

  // Fetch timeline logs
  const { data: logsData } = await supabase
    .from("ticket_logs")
    .select("*")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  const logs: TicketLog[] = (logsData || []).map((l: any) => ({
    id: l.id,
    ticketId: l.ticket_id,
    clientId: l.client_id,
    eventType: l.event_type,
    description: l.description,
    performedBy: l.performed_by || "System",
    metadata: l.metadata,
    createdAt: l.created_at,
  }));

  ticket.logs = logs;

  return { success: true, data: { ticket } };
}

export async function createSupportTicketAction(values: {
  subject: string;
  description: string;
  category?: TicketCategory;
  department?: TicketDepartment;
  priority?: TicketPriority;
  serviceId?: string;
}) {
  const user = await requireClient();
  const supabase = user.role === "admin" ? getAdmin() : await createServerSupabaseClient() as any;

  // Find linked client record
  const { data: clientRec } = await supabase
    .from("clients")
    .select("id")
    .eq("profile_id", user.id)
    .limit(1)
    .maybeSingle();

  let clientId = clientRec?.id;

  if (!clientId) {
    const accountNumber = `NXS-${Date.now().toString(36).toUpperCase()}`;
    const { data: newCli } = await supabase
      .from("clients")
      .insert({
        company_name: user.companyName || user.fullName || user.email,
        full_name: user.fullName || user.email,
        primary_email: user.email,
        account_number: accountNumber,
        profile_id: user.id,
      })
      .select()
      .single();
    clientId = newCli?.id;
  }

  if (!clientId) {
    return { success: false, error: "Failed to locate client account record." };
  }

  const seqStr = String(Date.now()).slice(-4);
  const ticketNumber = `TKT-${new Date().getFullYear()}-${seqStr}`;
  const dept = values.department || values.category || "general";
  const prio = values.priority || "medium";

  const { data: newTicketRow, error } = await supabase
    .from("support_tickets")
    .insert({
      client_id: clientId,
      service_id: values.serviceId || null,
      ticket_number: ticketNumber,
      subject: values.subject,
      description: values.description,
      category: dept,
      department: dept,
      priority: prio,
      status: "open",
      created_by: user.id,
    })
    .select()
    .single();

  if (error || !newTicketRow) {
    return { success: false, error: `Failed to create support ticket: ${error?.message}` };
  }

  // Insert initial ticket log
  await supabase.from("ticket_logs").insert({
    ticket_id: newTicketRow.id,
    client_id: clientId,
    event_type: "ticket_created",
    description: `Ticket ${ticketNumber} opened by ${user.fullName || user.email}.`,
    performed_by: user.fullName || user.email,
  });

  revalidatePath("/client/support");
  revalidatePath("/admin/support");

  return { success: true, data: { ticketId: newTicketRow.id, ticketNumber } };
}

export async function addTicketMessageAction(
  ticketId: string,
  message: string,
  isInternal: boolean = false,
  attachments: any[] = []
) {
  const user = await requireAuth();
  const supabase = user.role === "admin" ? getAdmin() : await createServerSupabaseClient() as any;

  if (user.role === "client" && isInternal) {
    return { success: false, error: "Unauthorized attempt to create internal note." };
  }

  const { error } = await supabase.from("ticket_messages").insert({
    ticket_id: ticketId,
    sender_id: user.id,
    sender_name: user.fullName || user.email,
    sender_role: user.role,
    message,
    is_internal: isInternal,
    attachments,
  });

  if (error) {
    return { success: false, error: `Failed to post reply: ${error.message}` };
  }

  // Update status and timestamp
  const newStatus = isInternal
    ? undefined
    : user.role === "admin"
    ? "waiting_client"
    : "waiting_staff";

  const updateData: any = { updated_at: new Date().toISOString() };
  if (newStatus) updateData.status = newStatus;

  await supabase.from("support_tickets").update(updateData).eq("id", ticketId);

  // Record event log
  await supabase.from("ticket_logs").insert({
    ticket_id: ticketId,
    event_type: isInternal ? "internal_note_added" : "reply_added",
    description: isInternal
      ? `Internal staff note added by ${user.fullName || user.email}.`
      : `Response posted by ${user.fullName || user.email} (${user.role}).`,
    performed_by: user.fullName || user.email,
  });

  revalidatePath("/client/support");
  revalidatePath("/admin/support");

  return { success: true };
}

export async function updateTicketStatusAction(ticketId: string, status: TicketStatus) {
  const user = await requireAuth();
  const supabase = user.role === "admin" ? getAdmin() : await createServerSupabaseClient() as any;

  const updateData: any = { status, updated_at: new Date().toISOString() };
  if (status === "resolved") updateData.resolved_at = new Date().toISOString();
  if (status === "closed") updateData.closed_at = new Date().toISOString();

  const { error } = await supabase
    .from("support_tickets")
    .update(updateData)
    .eq("id", ticketId);

  if (error) {
    return { success: false, error: `Failed to update status: ${error.message}` };
  }

  await supabase.from("ticket_logs").insert({
    ticket_id: ticketId,
    event_type: "status_changed",
    description: `Ticket status updated to ${status.toUpperCase().replace(/_/g, " ")} by ${user.fullName || user.email}.`,
    performed_by: user.fullName || user.email,
  });

  revalidatePath("/client/support");
  revalidatePath("/admin/support");

  return { success: true };
}

export async function updateTicketPriorityAction(ticketId: string, priority: TicketPriority) {
  const user = await requireAdmin();
  const supabase = getAdmin();

  const { error } = await supabase
    .from("support_tickets")
    .update({ priority, updated_at: new Date().toISOString() })
    .eq("id", ticketId);

  if (error) {
    return { success: false, error: `Failed to update priority: ${error.message}` };
  }

  await supabase.from("ticket_logs").insert({
    ticket_id: ticketId,
    event_type: "priority_changed",
    description: `Ticket priority escalated to ${priority.toUpperCase()} by ${user.fullName || user.email}.`,
    performed_by: user.fullName || user.email,
  });

  revalidatePath("/admin/support");
  return { success: true };
}

export async function updateTicketDepartmentAction(ticketId: string, department: TicketDepartment) {
  const user = await requireAdmin();
  const supabase = getAdmin();

  const { error } = await supabase
    .from("support_tickets")
    .update({ department, category: department, updated_at: new Date().toISOString() })
    .eq("id", ticketId);

  if (error) {
    return { success: false, error: `Failed to re-route department: ${error.message}` };
  }

  await supabase.from("ticket_logs").insert({
    ticket_id: ticketId,
    event_type: "department_changed",
    description: `Ticket re-routed to ${department.toUpperCase()} department by ${user.fullName || user.email}.`,
    performed_by: user.fullName || user.email,
  });

  revalidatePath("/admin/support");
  return { success: true };
}
