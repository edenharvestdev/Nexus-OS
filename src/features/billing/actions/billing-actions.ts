"use server";

import { revalidatePath } from "next/cache";
import { Invoice, InvoiceItem, InvoiceFilters, InvoiceStatus } from "@/types/billing";
import { createInvoiceSchema } from "../schemas/billing-schema";
import { requireAdmin, requireClient } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function getAdmin() {
  return createAdminClient() as any;
}

function mapRowToInvoice(row: any): Invoice {
  const items: InvoiceItem[] = (row.invoice_items || []).map((item: any) => ({
    id: item.id,
    invoiceId: item.invoice_id,
    title: item.description,
    description: item.description,
    quantity: item.quantity,
    unitPrice: Number(item.unit_price || 0),
    discount: 0,
    taxRate: 0,
    taxAmount: 0,
    subtotal: Number(item.amount || 0),
    serviceId: item.service_id || undefined,
  }));

  const subtotal = Number(row.subtotal || 0);
  const taxAmount = Number(row.tax || 0);
  const discountAmount = Number(row.discount || 0);
  const grandTotal = Number(row.total || 0);
  const status = row.status as InvoiceStatus;
  const isPaid = status === "paid";

  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    clientId: row.client_id,
    clientName: row.clients?.full_name || row.clients?.company_name || "Client Account",
    companyName: row.clients?.company_name || "Organization",
    clientEmail: row.clients?.primary_email || "billing@client.com",
    billingAddress: row.clients?.billing_address || row.clients?.country || "Main Address",
    country: row.clients?.country || "United States",
    issueDate: row.issue_date,
    dueDate: row.due_date,
    currency: row.currency || "USD",
    invoiceStatus: status,
    billingType: (row.billing_type as any) || "recurring",
    notes: row.notes || undefined,
    clientNotes: row.notes || "Thank you for your business!",
    terms: row.terms || "Net 30. Standard Enterprise Service SLA applies.",
    taxRate: subtotal > 0 ? (taxAmount / subtotal) * 100 : 0,
    taxAmount,
    discountAmount,
    subtotal,
    grandTotal,
    paidAmount: isPaid ? grandTotal : 0,
    balanceDue: isPaid ? 0 : grandTotal,
    createdBy: "Admin",
    updatedBy: "Admin",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
    attachments: [],
    activities: [],
  };
}

export async function getInvoicesAction(filters: InvoiceFilters = {}) {
  const user = await requireClient();
  const supabase = user.role === "admin" ? getAdmin() : await createServerSupabaseClient() as any;

  let query = supabase
    .from("invoices")
    .select(`
      *,
      clients (id, company_name, full_name, primary_email, billing_address, country),
      invoice_items (*)
    `)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

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
      return {
        success: true,
        data: { invoices: [], total: 0, page: 1, totalPages: 0 },
      };
    }
  } else if (filters.clientId) {
    query = query.eq("client_id", filters.clientId);
  }

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  if (filters.clientId) {
    query = query.eq("client_id", filters.clientId);
  }

  if (filters.currency) {
    query = query.eq("currency", filters.currency);
  }

  const { data, error } = await query;

  if (error) {
    return { success: false, error: `Database error: ${error.message}` };
  }

  let result: Invoice[] = (data || []).map(mapRowToInvoice);

  // Search filter
  if (filters.search && filters.search.trim() !== "") {
    const q = filters.search.toLowerCase().trim();
    result = result.filter(
      (inv: Invoice) =>
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.clientName.toLowerCase().includes(q) ||
        inv.companyName.toLowerCase().includes(q) ||
        inv.clientEmail.toLowerCase().includes(q) ||
        (inv.notes && inv.notes.toLowerCase().includes(q)) ||
        inv.grandTotal.toString().includes(q)
    );
  }

  const page = filters.page || 1;
  const limit = filters.limit || 10;
  const total = result.length;
  const totalPages = Math.ceil(total / limit);
  const startIndex = (page - 1) * limit;
  const paginatedData = result.slice(startIndex, startIndex + limit);

  return {
    success: true,
    data: {
      invoices: paginatedData,
      total,
      page,
      totalPages,
    },
  };
}

export async function getInvoiceByIdAction(id: string) {
  const user = await requireClient();
  const supabase = user.role === "admin" ? getAdmin() : await createServerSupabaseClient() as any;

  const { data, error } = await supabase
    .from("invoices")
    .select(`
      *,
      clients (id, company_name, full_name, primary_email, billing_address, country),
      invoice_items (*)
    `)
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (error || !data) {
    return { success: false, error: "Invoice record not found." };
  }

  return { success: true, data: mapRowToInvoice(data) };
}

export async function createInvoiceAction(rawValues: any) {
  const user = await requireAdmin();
  const supabase = getAdmin();

  const validation = createInvoiceSchema.safeParse(rawValues);
  if (!validation.success) {
    return {
      success: false,
      error: "Validation failed. Please check line items and due dates.",
      fieldErrors: validation.error.flatten().fieldErrors,
    };
  }

  const data = validation.data;

  // Generate unique invoice number
  const invoiceSeq = Date.now().toString().slice(-6);
  const year = new Date().getFullYear();
  const invoiceNumber = `INV-${year}-${invoiceSeq}`;

  let subtotal = 0;
  let taxAmount = 0;

  data.items.forEach((item: any) => {
    const itemSubtotal = item.quantity * item.unitPrice - item.discount;
    const itemTax = (itemSubtotal * (item.taxRate || data.taxRate)) / 100;
    subtotal += itemSubtotal;
    taxAmount += itemTax;
  });

  const grandTotal = subtotal + taxAmount - data.discountAmount;

  const { data: newInvoiceRow, error: invError } = await supabase
    .from("invoices")
    .insert({
      client_id: data.clientId,
      invoice_number: invoiceNumber,
      status: "unpaid",
      issue_date: data.issueDate ? data.issueDate.substring(0, 10) : new Date().toISOString().substring(0, 10),
      due_date: data.dueDate ? data.dueDate.substring(0, 10) : new Date().toISOString().substring(0, 10),
      currency: data.currency,
      subtotal,
      tax: taxAmount,
      discount: data.discountAmount,
      total: grandTotal,
      notes: data.notes || null,
      terms: data.terms || null,
      billing_type: data.billingType,
      created_by: user.id,
    })
    .select()
    .single();

  if (invError || !newInvoiceRow) {
    return { success: false, error: `Failed to create invoice: ${invError?.message}` };
  }

  // Insert line items
  const itemsToInsert = data.items.map((item: any) => ({
    invoice_id: newInvoiceRow.id,
    service_id: item.serviceId || null,
    description: item.title,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    amount: item.quantity * item.unitPrice - item.discount,
  }));

  await supabase.from("invoice_items").insert(itemsToInsert);

  revalidatePath("/admin/invoices");
  revalidatePath("/admin/billing");
  revalidatePath("/client/invoices");

  const fetched = await getInvoiceByIdAction(newInvoiceRow.id);
  return fetched.success ? fetched : { success: true, data: mapRowToInvoice(newInvoiceRow) };
}

export async function updateInvoiceStatusAction(invoiceId: string, newStatus: InvoiceStatus) {
  await requireAdmin();
  const supabase = getAdmin();

  const { error } = await supabase
    .from("invoices")
    .update({ status: newStatus })
    .eq("id", invoiceId);

  if (error) {
    return { success: false, error: `Failed to update invoice status: ${error.message}` };
  }

  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${invoiceId}`);
  revalidatePath("/admin/billing");
  revalidatePath("/client/invoices");

  const fetched = await getInvoiceByIdAction(invoiceId);
  return fetched.success ? fetched : { success: true, data: null as any };
}
