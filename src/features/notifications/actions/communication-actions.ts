"use server";

import {
  ClientNotification,
  EmailLogRecord,
  AnnouncementRecord,
  EmailTemplateRecord,
  CommunicationStats,
  NotificationCategory,
  NotificationPriority,
  NotificationStatus,
} from "@/types/notification";
import { requireClient, requireAdmin, requireAuth } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function getAdmin() {
  return createAdminClient() as any;
}

export async function getClientNotificationsAction() {
  const user = await requireClient();
  const supabase = user.role === "admin" ? getAdmin() : await createServerSupabaseClient() as any;

  // Find linked client record
  const { data: clientRec } = await supabase
    .from("clients")
    .select("id")
    .eq("profile_id", user.id)
    .limit(1)
    .maybeSingle();

  let query = supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false });

  if (clientRec) {
    query = query.or(`client_id.eq.${clientRec.id},recipient_id.eq.${user.id}`);
  } else {
    query = query.eq("recipient_id", user.id);
  }

  const { data, error } = await query;

  if (error) {
    return { success: false, error: `Failed to fetch notifications: ${error.message}` };
  }

  const notifications: ClientNotification[] = (data || []).map((n: any) => ({
    id: n.id,
    clientId: n.client_id || "",
    recipientId: n.recipient_id || undefined,
    title: n.title,
    message: n.message,
    category: (n.category as NotificationCategory) || "system",
    priority: (n.priority as NotificationPriority) || "normal",
    status: (n.status as NotificationStatus) || "unread",
    actionUrl: n.action_url || undefined,
    actionLabel: n.action_label || undefined,
    metadata: n.metadata,
    createdAt: n.created_at,
    readAt: n.read_at || undefined,
  }));

  return { success: true, data: { notifications } };
}

export async function markNotificationReadAction(id: string) {
  const user = await requireAuth();
  const supabase = user.role === "admin" ? getAdmin() : await createServerSupabaseClient() as any;

  await supabase
    .from("notifications")
    .update({ status: "read", read_at: new Date().toISOString() })
    .eq("id", id);

  revalidatePath("/client/notifications");
  return { success: true };
}

export async function markAllNotificationsReadAction() {
  const user = await requireClient();
  const supabase = user.role === "admin" ? getAdmin() : await createServerSupabaseClient() as any;

  const { data: clientRec } = await supabase
    .from("clients")
    .select("id")
    .eq("profile_id", user.id)
    .limit(1)
    .maybeSingle();

  const now = new Date().toISOString();

  if (clientRec) {
    await supabase
      .from("notifications")
      .update({ status: "read", read_at: now })
      .or(`client_id.eq.${clientRec.id},recipient_id.eq.${user.id}`)
      .eq("status", "unread");
  }

  revalidatePath("/client/notifications");
  return { success: true };
}

export async function getAdminCommunicationStatsAction() {
  await requireAdmin();
  const supabase = getAdmin();

  const [emailRes, failedRes, notifRes, annRes] = await Promise.all([
    supabase.from("email_logs").select("id", { count: "exact", head: true }),
    supabase.from("email_logs").select("id", { count: "exact", head: true }).eq("status", "failed"),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("status", "unread"),
    supabase.from("announcements").select("id", { count: "exact", head: true }).eq("status", "published"),
  ]);

  const stats: CommunicationStats = {
    totalEmailsSent: emailRes.count || 0,
    failedEmails: failedRes.count || 0,
    unreadNotifications: notifRes.count || 0,
    activeAnnouncements: annRes.count || 0,
  };

  return { success: true, data: { stats } };
}

export async function getAnnouncementsAction() {
  const user = await requireAuth();
  const supabase = user.role === "admin" ? getAdmin() : await createServerSupabaseClient() as any;

  const { data, error } = await supabase
    .from("announcements")
    .select("*")
    .order("published_at", { ascending: false });

  if (error) {
    return { success: false, error: error.message };
  }

  const announcements: AnnouncementRecord[] = (data || []).map((a: any) => ({
    id: a.id,
    title: a.title,
    content: a.content,
    category: a.category,
    audience: a.audience,
    targetClientIds: a.target_client_ids || [],
    status: a.status,
    publishedAt: a.published_at,
    createdBy: a.created_by,
    createdAt: a.created_at,
  }));

  return { success: true, data: { announcements } };
}

export async function createAnnouncementAction(values: {
  title: string;
  content: string;
  category: "announcement" | "maintenance" | "downtime" | "feature" | "update";
  audience: "all" | "specific_clients";
}) {
  const user = await requireAdmin();
  const supabase = getAdmin();

  const { data: newAnn, error } = await supabase
    .from("announcements")
    .insert({
      title: values.title,
      content: values.content,
      category: values.category,
      audience: values.audience,
      status: "published",
      created_by: user.id,
    })
    .select()
    .single();

  if (error || !newAnn) {
    return { success: false, error: `Failed to publish announcement: ${error?.message}` };
  }

  // Create in-app notifications for all clients
  const { data: allClients } = await supabase.from("clients").select("id");
  if (allClients && allClients.length > 0) {
    const notifRows = allClients.map((cli: any) => ({
      client_id: cli.id,
      title: `Announcement: ${values.title}`,
      message: values.content,
      category: "announcements",
      priority: "normal",
      status: "unread",
      action_url: "/client/notifications",
      action_label: "View Notice",
    }));

    await supabase.from("notifications").insert(notifRows);
  }

  revalidatePath("/admin/notifications");
  revalidatePath("/client/notifications");

  return { success: true };
}

export async function getEmailLogsAction() {
  await requireAdmin();
  const supabase = getAdmin();

  const { data, error } = await supabase
    .from("email_logs")
    .select("*")
    .order("sent_at", { ascending: false })
    .limit(100);

  if (error) {
    return { success: false, error: error.message };
  }

  const emailLogs: EmailLogRecord[] = (data || []).map((l: any) => ({
    id: l.id,
    clientId: l.client_id,
    recipientEmail: l.recipient_email,
    subject: l.subject,
    templateName: l.template_name,
    status: l.status,
    errorMessage: l.error_message,
    metadata: l.metadata,
    sentAt: l.sent_at,
    createdAt: l.created_at,
  }));

  return { success: true, data: { emailLogs } };
}

export async function getEmailTemplatesAction() {
  await requireAdmin();
  const supabase = getAdmin();

  const { data, error } = await supabase
    .from("email_templates")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    return { success: false, error: error.message };
  }

  const templates: EmailTemplateRecord[] = (data || []).map((t: any) => ({
    id: t.id,
    templateKey: t.template_key,
    name: t.name,
    subjectTemplate: t.subject_template,
    bodyTemplate: t.body_template,
    category: t.category,
    isActive: t.is_active,
    updatedAt: t.updated_at,
  }));

  return { success: true, data: { templates } };
}

export async function sendSystemNotificationAction(payload: {
  clientId: string;
  recipientEmail?: string;
  title: string;
  message: string;
  category: NotificationCategory;
  priority?: NotificationPriority;
  actionUrl?: string;
  actionLabel?: string;
  templateName?: string;
}) {
  await requireAdmin();
  const supabase = getAdmin();

  // Insert in-app notification
  await supabase.from("notifications").insert({
    client_id: payload.clientId,
    title: payload.title,
    message: payload.message,
    category: payload.category,
    priority: payload.priority || "normal",
    status: "unread",
    action_url: payload.actionUrl,
    action_label: payload.actionLabel,
  });

  // Log email dispatch record
  if (payload.recipientEmail) {
    await supabase.from("email_logs").insert({
      client_id: payload.clientId,
      recipient_email: payload.recipientEmail,
      subject: payload.title,
      template_name: payload.templateName || payload.category,
      status: "sent",
    });
  }

  revalidatePath("/client/notifications");
  revalidatePath("/admin/notifications");

  return { success: true };
}
