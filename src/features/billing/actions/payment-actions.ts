"use server";

import { revalidatePath } from "next/cache";
import { requireClient, requireAdmin, requireAuth } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  PaymentRecord,
  PaymentFilters,
  PaymentLog,
  PaymentReceipt,
  PaymentTransaction,
} from "@/types/payment";

function getAdmin() {
  return createAdminClient() as any;
}

function mapRowToPayment(row: any): PaymentRecord {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.clients?.full_name || row.clients?.company_name || "Client Account",
    companyName: row.clients?.company_name || "Organization",
    clientEmail: row.clients?.primary_email || "billing@client.com",
    invoiceId: row.invoice_id || undefined,
    invoiceNumber: row.invoices?.invoice_number || undefined,
    paymentNumber: row.payment_number,
    amount: Number(row.amount || 0),
    currency: row.currency || "USD",
    method: row.method || "manual",
    status: row.status || "pending",
    paymentDate: row.payment_date || row.created_at,
    notes: row.notes || undefined,
    rawPayload: row.raw_payload || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Retrieves payment history with filters. Supports Admin & Client portal.
 */
export async function getPaymentsAction(filters: PaymentFilters = {}) {
  const user = await requireClient();
  const supabase = user.role === "admin" ? getAdmin() : await createServerSupabaseClient() as any;

  let query = supabase
    .from("payments")
    .select(`
      *,
      clients (id, company_name, full_name, primary_email),
      invoices (id, invoice_number)
    `)
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
      return { success: true, data: { payments: [], total: 0, page: 1, totalPages: 0 } };
    }
  } else if (filters.clientId) {
    query = query.eq("client_id", filters.clientId);
  }

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  if (filters.invoiceId) {
    query = query.eq("invoice_id", filters.invoiceId);
  }

  const { data, error } = await query;

  if (error) {
    return { success: false, error: `Database error: ${error.message}` };
  }

  let result: PaymentRecord[] = (data || []).map(mapRowToPayment);

  if (filters.search && filters.search.trim() !== "") {
    const q = filters.search.toLowerCase().trim();
    result = result.filter(
      (p) =>
        p.paymentNumber.toLowerCase().includes(q) ||
        (p.invoiceNumber && p.invoiceNumber.toLowerCase().includes(q)) ||
        (p.companyName && p.companyName.toLowerCase().includes(q)) ||
        (p.clientName && p.clientName.toLowerCase().includes(q))
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
      payments: paginatedData,
      total,
      page,
      totalPages,
    },
  };
}

/**
 * Retrieves full single payment details, logs, transaction response, and receipt.
 */
export async function getPaymentDetailsAction(paymentId: string) {
  const user = await requireClient();
  const supabase = user.role === "admin" ? getAdmin() : await createServerSupabaseClient() as any;

  const { data: paymentRow, error } = await supabase
    .from("payments")
    .select(`
      *,
      clients (id, company_name, full_name, primary_email),
      invoices (id, invoice_number)
    `)
    .eq("id", paymentId)
    .single();

  if (error || !paymentRow) {
    return { success: false, error: "Payment record not found." };
  }

  const payment = mapRowToPayment(paymentRow);

  // Fetch timeline logs
  const { data: logsData } = await supabase
    .from("payment_logs")
    .select("*")
    .eq("payment_id", paymentId)
    .order("created_at", { ascending: true });

  const logs: PaymentLog[] = (logsData || []).map((l: any) => ({
    id: l.id,
    paymentId: l.payment_id,
    invoiceId: l.invoice_id,
    clientId: l.client_id,
    eventType: l.event_type,
    description: l.description,
    performedBy: l.performed_by || "System",
    metadata: l.metadata,
    createdAt: l.created_at,
  }));

  // Fetch transaction details
  const { data: trxData } = await supabase
    .from("payment_transactions")
    .select("*")
    .eq("payment_id", paymentId)
    .maybeSingle();

  const transaction: PaymentTransaction | null = trxData
    ? {
        id: trxData.id,
        paymentId: trxData.payment_id,
        gatewayName: trxData.gateway_name,
        transactionId: trxData.transaction_id,
        senderNumber: trxData.sender_number || undefined,
        gatewayFee: Number(trxData.gateway_fee || 0),
        method: trxData.method || "manual",
        status: trxData.status || "COMPLETED",
        rawPayload: trxData.raw_payload || undefined,
        verifiedAt: trxData.verified_at || undefined,
        createdAt: trxData.created_at,
      }
    : null;

  // Fetch receipt if generated
  const { data: receiptData } = await supabase
    .from("receipts")
    .select("*")
    .eq("payment_id", paymentId)
    .maybeSingle();

  const receipt: PaymentReceipt | null = receiptData
    ? {
        id: receiptData.id,
        paymentId: receiptData.payment_id,
        invoiceId: receiptData.invoice_id,
        receiptNumber: receiptData.receipt_number,
        invoiceNumber: receiptData.invoice_number || payment.invoiceNumber || "N/A",
        clientName: receiptData.client_name || payment.clientName || "Client",
        companyName: receiptData.company_name || payment.companyName || "Organization",
        amount: Number(receiptData.amount || payment.amount),
        currency: receiptData.currency || payment.currency,
        paymentMethod: receiptData.payment_method || payment.method,
        transactionId: receiptData.transaction_id || transaction?.transactionId || "N/A",
        items: receiptData.items || [],
        pdfUrl: receiptData.pdf_url || undefined,
        issuedAt: receiptData.issued_at,
      }
    : null;

  return {
    success: true,
    data: {
      payment,
      logs,
      transaction,
      receipt,
    },
  };
}

/**
 * Manually marks a payment as verified (Admin Override).
 */
export async function manuallyVerifyPaymentAction(paymentId: string, notes: string) {
  const user = await requireAdmin();
  const supabase = getAdmin();

  const { data: paymentRow, error } = await supabase
    .from("payments")
    .select("*, invoices(*), clients(*)")
    .eq("id", paymentId)
    .single();

  if (error || !paymentRow) {
    return { success: false, error: "Payment not found." };
  }

  await supabase
    .from("payments")
    .update({ status: "completed", notes: notes || "Manually verified by admin" })
    .eq("id", paymentId);

  if (paymentRow.invoice_id) {
    await supabase
      .from("invoices")
      .update({
        status: "paid",
        paid_amount: paymentRow.amount,
        balance_due: 0,
      })
      .eq("id", paymentRow.invoice_id);
  }

  const receiptNum = `RCT-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
  await supabase.from("receipts").upsert({
    payment_id: paymentId,
    invoice_id: paymentRow.invoice_id,
    client_id: paymentRow.client_id,
    receipt_number: receiptNum,
    invoice_number: paymentRow.invoices?.invoice_number || "INV-000",
    client_name: paymentRow.clients?.full_name || "Client",
    company_name: paymentRow.clients?.company_name || "Organization",
    amount: paymentRow.amount,
    currency: paymentRow.currency,
    payment_method: "manual_override",
    transaction_id: `MANUAL-${Date.now()}`,
    issued_at: new Date().toISOString(),
  }, { onConflict: "payment_id" });

  await supabase.from("payment_logs").insert({
    payment_id: paymentId,
    invoice_id: paymentRow.invoice_id,
    client_id: paymentRow.client_id,
    event_type: "manual_verified",
    description: `Payment manually marked as completed by Admin ${user.fullName || user.email}. Notes: ${notes}`,
    performed_by: user.fullName || user.email,
  });

  revalidatePath(`/admin/billing/payments`);
  revalidatePath(`/client/invoices/${paymentRow.invoice_id}`);

  return { success: true };
}
