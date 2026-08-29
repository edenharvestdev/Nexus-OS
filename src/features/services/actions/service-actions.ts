"use server";

import { revalidatePath } from "next/cache";
import {
  ServiceCategory,
  ServiceTemplate,
  ClientService,
  ServiceFilters,
  ServiceStatus,
} from "@/types/service";
import {
  serviceCategorySchema,
  serviceTemplateSchema,
  assignServiceSchema,
  updateServiceSchema,
} from "../schemas/service-schema";
import { requireAdmin, requireClient } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { protectCredential } from "@/lib/security/credential-secret-provider";
import { createInvoiceAction } from "@/features/billing/actions/billing-actions";

function getAdmin() {
  return createAdminClient() as any;
}

// ── SERVICE CATEGORIES (100% DATABASE DRIVEN) ──────────────────────────────

export async function getServiceCategoriesAction() {
  await requireAdmin();
  const supabase = getAdmin();

  const { data, error } = await supabase
    .from("service_categories")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return { success: false, error: `Database error: ${error.message}` };
  }

  const categories: ServiceCategory[] = (data || []).map((row: any) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    iconName: row.icon_name || row.icon || undefined,
    description: row.description || undefined,
    color: row.color || "blue",
    createdAt: row.created_at,
  }));

  return { success: true, data: categories };
}

export async function createServiceCategoryAction(rawValues: any) {
  await requireAdmin();
  const supabase = getAdmin();

  const validation = serviceCategorySchema.safeParse(rawValues);
  if (!validation.success) {
    return { success: false, error: "Category validation failed." };
  }

  const data = validation.data;
  const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const { data: newRow, error } = await supabase
    .from("service_categories")
    .insert({
      name: data.name,
      slug,
      description: data.description || null,
      icon_name: data.iconName || null,
      color: data.color || "blue",
    })
    .select()
    .single();

  if (error || !newRow) {
    return { success: false, error: `Failed to create category: ${error?.message}` };
  }

  revalidatePath("/admin/services");

  const newCategory: ServiceCategory = {
    id: newRow.id,
    name: newRow.name,
    slug: newRow.slug,
    iconName: newRow.icon_name || undefined,
    description: newRow.description || undefined,
    color: newRow.color || "blue",
    createdAt: newRow.created_at,
  };

  return { success: true, data: newCategory };
}

// ── SERVICE TEMPLATES (100% DATABASE DRIVEN) ────────────────────────────────

export async function getServiceTemplatesAction() {
  await requireAdmin();
  const supabase = getAdmin();

  const { data, error } = await supabase
    .from("service_templates")
    .select(`
      *,
      service_categories (id, name)
    `)
    .order("name", { ascending: true });

  if (error) {
    return { success: false, error: `Database error: ${error.message}` };
  }

  const templates: ServiceTemplate[] = (data || []).map((row: any) => ({
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.service_categories?.name || "General Service",
    name: row.name,
    description: row.description || "",
    iconName: row.icon_name || undefined,
    defaultPrice: Number(row.default_price || 0),
    currency: row.currency || "USD",
    billingCycle: row.billing_cycle || "monthly",
    renewable: row.renewable ?? true,
    autoRenewal: row.auto_renewal ?? true,
    visibility: row.visibility || "public",
    status: row.status || "active",
    defaultNotes: row.default_notes || undefined,
    tags: row.tags || [],
    createdAt: row.created_at,
  }));

  return { success: true, data: templates };
}

export async function createServiceTemplateAction(rawValues: any) {
  await requireAdmin();
  const supabase = getAdmin();

  const validation = serviceTemplateSchema.safeParse(rawValues);
  if (!validation.success) {
    return { success: false, error: "Template validation failed." };
  }

  const d = validation.data;

  const { data: newRow, error } = await supabase
    .from("service_templates")
    .insert({
      category_id: d.categoryId,
      name: d.name,
      description: d.description || null,
      icon_name: d.iconName || null,
      default_price: d.defaultPrice,
      currency: d.currency,
      billing_cycle: d.billingCycle,
      renewable: d.renewable,
      auto_renewal: d.autoRenewal,
      visibility: d.visibility,
      status: d.status,
      default_notes: d.defaultNotes || null,
      tags: d.tags || [],
    })
    .select(`*, service_categories(name)`)
    .single();

  if (error || !newRow) {
    return { success: false, error: `Failed to create template: ${error?.message}` };
  }

  revalidatePath("/admin/services");

  const newTemplate: ServiceTemplate = {
    id: newRow.id,
    categoryId: newRow.category_id,
    categoryName: newRow.service_categories?.name || "General Service",
    name: newRow.name,
    description: newRow.description || "",
    iconName: newRow.icon_name || undefined,
    defaultPrice: Number(newRow.default_price || 0),
    currency: newRow.currency || "USD",
    billingCycle: newRow.billing_cycle || "monthly",
    renewable: newRow.renewable ?? true,
    autoRenewal: newRow.auto_renewal ?? true,
    visibility: newRow.visibility || "public",
    status: newRow.status || "active",
    defaultNotes: newRow.default_notes || undefined,
    tags: newRow.tags || [],
    createdAt: newRow.created_at,
  };

  return { success: true, data: newTemplate };
}

// ── CLIENT SERVICES (100% DATABASE DRIVEN) ─────────────────────────────────

export async function getClientServicesAction(filters: ServiceFilters = {}) {
  const user = await requireClient();
  const supabase = user.role === "admin" ? getAdmin() : await createServerSupabaseClient() as any;

  let query = supabase
    .from("services")
    .select(`
      *,
      clients (id, company_name, full_name, primary_email),
      service_categories (id, name)
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
        data: { services: [], total: 0, page: 1, totalPages: 0 },
      };
    }
  } else if (filters.clientId) {
    query = query.eq("client_id", filters.clientId);
  }

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  if (filters.categoryId) {
    query = query.eq("category_id", filters.categoryId);
  }

  if (filters.clientId) {
    query = query.eq("client_id", filters.clientId);
  }

  if (filters.billingCycle && filters.billingCycle !== "all") {
    query = query.eq("billing_cycle", filters.billingCycle);
  }

  const { data, error } = await query;

  if (error) {
    return { success: false, error: `Database error: ${error.message}` };
  }

  let result: ClientService[] = (data || []).map((row: any) => {
    const meta = row.metadata || {};
    return {
      id: row.id,
      clientId: row.client_id,
      clientName: row.clients?.full_name || row.clients?.company_name || "Client Account",
      companyName: row.clients?.company_name || "Organization",
      templateId: meta.template_id || undefined,
      customName: row.name,
      categoryId: row.category_id,
      categoryName: row.service_categories?.name || "Digital Asset",
      customPrice: Number(row.price || 0),
      currency: row.currency || "USD",
      billingCycle: row.billing_cycle || "monthly",
      purchaseDate: row.purchase_date,
      activationDate: meta.activation_date || row.purchase_date,
      renewalDate: row.renewal_date || row.purchase_date,
      expirationDate: row.renewal_date || row.purchase_date,
      serviceStatus: row.status as ServiceStatus,
      autoRenewal: row.auto_renew ?? true,
      domainName: meta.domain_name || undefined,
      serverIp: meta.server_ip || undefined,
      cloudflareZoneId: meta.cloudflare_zone_id || undefined,
      internalNotes: meta.internal_notes || undefined,
      clientNotes: row.description || undefined,
      tags: meta.tags || [],
      renewals: [],
      files: [],
      activities: [],
      createdAt: row.created_at,
    };
  });

  // Search filter
  if (filters.search && filters.search.trim() !== "") {
    const q = filters.search.toLowerCase().trim();
    result = result.filter(
      (s: ClientService) =>
        s.customName.toLowerCase().includes(q) ||
        s.clientName.toLowerCase().includes(q) ||
        s.companyName.toLowerCase().includes(q) ||
        s.categoryName.toLowerCase().includes(q) ||
        (s.domainName && s.domainName.toLowerCase().includes(q)) ||
        (s.serverIp && s.serverIp.toLowerCase().includes(q)) ||
        s.tags.some((t: string) => t.toLowerCase().includes(q))
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
      services: paginatedData,
      total,
      page,
      totalPages,
    },
  };
}

export async function getServiceByIdAction(id: string) {
  await requireAdmin();
  const supabase = getAdmin();

  const { data, error } = await supabase
    .from("services")
    .select(`
      *,
      clients (id, company_name, full_name, primary_email),
      service_categories (id, name)
    `)
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (error || !data) {
    return { success: false, error: "Service / Asset record not found." };
  }

  const meta = data.metadata || {};
  const service: ClientService = {
    id: data.id,
    clientId: data.client_id,
    clientName: data.clients?.full_name || data.clients?.company_name || "Client Account",
    companyName: data.clients?.company_name || "Organization",
    templateId: meta.template_id || undefined,
    customName: data.name,
    categoryId: data.category_id,
    categoryName: data.service_categories?.name || "Digital Asset",
    customPrice: Number(data.price || 0),
    currency: data.currency || "USD",
    billingCycle: data.billing_cycle || "monthly",
    purchaseDate: data.purchase_date,
    activationDate: meta.activation_date || data.purchase_date,
    renewalDate: data.renewal_date || data.purchase_date,
    expirationDate: data.renewal_date || data.purchase_date,
    serviceStatus: data.status as ServiceStatus,
    autoRenewal: data.auto_renew ?? true,
    domainName: meta.domain_name || undefined,
    serverIp: meta.server_ip || undefined,
    cloudflareZoneId: meta.cloudflare_zone_id || undefined,
    internalNotes: meta.internal_notes || undefined,
    clientNotes: data.description || undefined,
    tags: meta.tags || [],
    renewals: [],
    files: [],
    activities: [],
    createdAt: data.created_at,
  };

  return { success: true, data: service };
}

export async function assignClientServiceAction(rawValues: any) {
  const user = await requireAdmin();
  const supabase = getAdmin();

  const validation = assignServiceSchema.safeParse(rawValues);
  if (!validation.success) {
    return {
      success: false,
      error: "Validation failed. Please check form inputs.",
      fieldErrors: validation.error.flatten().fieldErrors,
    };
  }

  const data = validation.data;

  // Compute service code
  const serviceCode = `SRV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;

  const { data: newService, error } = await supabase
    .from("services")
    .insert({
      client_id: data.clientId,
      category_id: data.categoryId || null,
      service_code: serviceCode,
      name: data.customName,
      description: data.clientNotes || null,
      status: data.serviceStatus,
      billing_cycle: data.billingCycle,
      currency: data.currency,
      price: data.customPrice,
      purchase_date: new Date().toISOString(),
      renewal_date: data.renewalDate || null,
      auto_renew: data.autoRenewal,
      metadata: {
        template_id: data.templateId || null,
        domain_name: data.domainName || null,
        server_ip: data.serverIp || null,
        cloudflare_zone_id: data.cloudflareZoneId || null,
        internal_notes: data.internalNotes || null,
        tags: data.tags || [],
      },
      created_by: user.id,
    })
    .select()
    .single();

  if (error || !newService) {
    return { success: false, error: `Failed to assign service: ${error?.message}` };
  }

  revalidatePath("/admin/services");

  const fetched = await getServiceByIdAction(newService.id);
  return fetched.success ? fetched : { success: true, data: newService };
}

export async function updateServiceStatusAction(serviceId: string, newStatus: ServiceStatus) {
  await requireAdmin();
  const supabase = getAdmin();

  const { error } = await supabase
    .from("services")
    .update({ status: newStatus })
    .eq("id", serviceId);

  if (error) {
    return { success: false, error: `Failed to update status: ${error.message}` };
  }

  revalidatePath("/admin/services");
  return { success: true };
}

export async function updateServiceAction(serviceId: string, rawValues: any) {
  await requireAdmin();
  const supabase = getAdmin();

  const validation = updateServiceSchema.safeParse(rawValues);
  if (!validation.success) {
    return {
      success: false,
      error: "Validation failed. Please check form inputs.",
      fieldErrors: validation.error.flatten().fieldErrors,
    };
  }

  const data = validation.data;

  const { data: updated, error } = await supabase
    .from("services")
    .update({
      name: data.customName,
      category_id: data.categoryId,
      status: data.serviceStatus,
      billing_cycle: data.billingCycle,
      currency: data.currency,
      price: data.customPrice,
      renewal_date: data.renewalDate || null,
      auto_renew: data.autoRenewal,
      description: data.clientNotes || null,
      metadata: {
        domain_name: data.domainName || null,
        server_ip: data.serverIp || null,
        cloudflare_zone_id: data.cloudflareZoneId || null,
        internal_notes: data.internalNotes || null,
        tags: data.tags || [],
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", serviceId)
    .is("deleted_at", null)
    .select(`
      *,
      clients (id, company_name, full_name, primary_email),
      service_categories (id, name)
    `)
    .single();

  if (error || !updated) {
    return { success: false, error: `Failed to update service: ${error?.message}` };
  }

  await supabase.from("service_activities").insert({
    service_id: serviceId,
    activity_type: "updated",
    title: "Service Details Updated",
    description: `Service [${data.customName}] was modified by admin.`,
    performed_by: "Admin",
  });

  revalidatePath("/admin/services");
  revalidatePath(`/admin/services/${serviceId}`);
  revalidatePath("/client/services");

  const meta = updated.metadata || {};
  const service: ClientService = {
    id: updated.id,
    clientId: updated.client_id,
    clientName: updated.clients?.full_name || updated.clients?.company_name || "Client Account",
    companyName: updated.clients?.company_name || "Organization",
    customName: updated.name,
    categoryId: updated.category_id,
    categoryName: updated.service_categories?.name || "Digital Asset",
    customPrice: Number(updated.price || 0),
    currency: updated.currency || "USD",
    billingCycle: updated.billing_cycle || "monthly",
    purchaseDate: updated.purchase_date,
    renewalDate: updated.renewal_date || updated.purchase_date,
    expirationDate: updated.renewal_date || updated.purchase_date,
    serviceStatus: updated.status as ServiceStatus,
    autoRenewal: updated.auto_renew ?? true,
    domainName: meta.domain_name || undefined,
    serverIp: meta.server_ip || undefined,
    cloudflareZoneId: meta.cloudflare_zone_id || undefined,
    internalNotes: meta.internal_notes || undefined,
    clientNotes: updated.description || undefined,
    tags: meta.tags || [],
    renewals: [],
    files: [],
    activities: [],
    createdAt: updated.created_at,
  };

  return { success: true, data: service };
}

export async function deleteServiceAction(serviceId: string) {
  await requireAdmin();
  const supabase = getAdmin();

  const { error } = await supabase
    .from("services")
    .update({
      deleted_at: new Date().toISOString(),
      status: "archived",
      updated_at: new Date().toISOString(),
    })
    .eq("id", serviceId)
    .is("deleted_at", null);

  if (error) {
    return { success: false, error: `Failed to delete service: ${error.message}` };
  }

  await supabase.from("service_activities").insert({
    service_id: serviceId,
    activity_type: "cancelled",
    title: "Service Removed by Admin",
    description: "Service was soft-deleted (archived) via admin panel.",
    performed_by: "Admin",
  });

  revalidatePath("/admin/services");
  revalidatePath("/admin/clients");
  revalidatePath("/client/services");

  return { success: true };
}

export async function renewServiceAction(serviceId: string) {
  await requireAdmin();
  const supabase = getAdmin();

  const { data: service, error: findError } = await supabase
    .from("services")
    .select(`
      id, client_id, name, price, currency, billing_cycle, renewal_date,
      clients (id, company_name, full_name, primary_email)
    `)
    .eq("id", serviceId)
    .single();

  if (findError || !service) {
    return { success: false, error: "Service not found." };
  }

  const currentRenewal = service.renewal_date ? new Date(service.renewal_date) : new Date();
  if (service.billing_cycle === "monthly") {
    currentRenewal.setMonth(currentRenewal.getMonth() + 1);
  } else if (service.billing_cycle === "annual") {
    currentRenewal.setFullYear(currentRenewal.getFullYear() + 1);
  } else if (service.billing_cycle === "quarterly") {
    currentRenewal.setMonth(currentRenewal.getMonth() + 3);
  } else if (service.billing_cycle === "semi_annual") {
    currentRenewal.setMonth(currentRenewal.getMonth() + 6);
  } else if (service.billing_cycle === "biennial") {
    currentRenewal.setFullYear(currentRenewal.getFullYear() + 2);
  } else {
    currentRenewal.setFullYear(currentRenewal.getFullYear() + 1);
  }

  const { error: updateError } = await supabase
    .from("services")
    .update({ renewal_date: currentRenewal.toISOString(), status: "active" })
    .eq("id", serviceId);

  if (updateError) {
    return { success: false, error: `Failed to renew service: ${updateError.message}` };
  }

  const serviceName = service.name;
  const servicePrice = Number(service.price || 0);
  const serviceCurrency = service.currency || "USD";
  const serviceBillingCycle = service.billing_cycle || "monthly";
  const serviceClientId = service.client_id;

  if (serviceClientId && servicePrice > 0) {
    const now = new Date();
    const issueDate = now.toISOString().substring(0, 10);
    const dueDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

    const invoiceItems = [
      {
        title: `${serviceName} Renewal`,
        description: `Automated renewal billing for ${serviceBillingCycle} cycle.`,
        quantity: 1,
        unitPrice: servicePrice,
        discount: 0,
        taxRate: 0,
        serviceId: serviceId,
        serviceName,
      },
    ];

    const invoicePayload: any = {
      clientId: serviceClientId,
      items: invoiceItems,
      issueDate,
      dueDate,
      currency: serviceCurrency,
      billingType: "renewal",
      taxRate: 0,
      discountAmount: 0,
      notes: `Auto-generated renewal invoice for ${serviceName} (${serviceBillingCycle}).`,
      terms: "Net 30. Standard Enterprise Service SLA applies.",
    };

    createInvoiceAction(invoicePayload).catch((err) => {
      console.error("Auto-invoice creation failed after renewal:", err);
    });
  }

  revalidatePath("/admin/services");
  revalidatePath(`/admin/services/${serviceId}`);
  revalidatePath("/admin/clients");
  revalidatePath("/client/services");
  revalidatePath("/client/renewals");
  revalidatePath("/client/invoices");

  return { success: true };
}

// ── CREDENTIALS VAULT ACTIONS ────────────────────────────────────────────────

export async function getServiceCredentialsAction(serviceId: string) {
  const user = await requireClient();
  const supabase = user.role === "admin" ? getAdmin() : await createServerSupabaseClient() as any;

  let query = supabase
    .from("service_credentials")
    .select("id, service_id, credential_name, username, login_url, is_client_visible, created_at")
    .eq("service_id", serviceId)
    .order("created_at", { ascending: false });

  if (user.role === "client") {
    query = query.eq("is_client_visible", true);
  }

  const { data, error } = await query;

  if (error) {
    return { success: false, error: error.message };
  }

  const credentials = (data || []).map((c: any) => ({
    id: c.id,
    serviceId: c.service_id,
    credentialName: c.credential_name || "Login Credentials",
    username: c.username || undefined,
    password: undefined,
    loginUrl: c.login_url || undefined,
    apiKey: undefined,
    licenseKey: undefined,
    secretNotes: undefined,
    isClientVisible: Boolean(c.is_client_visible),
    createdAt: c.created_at,
  }));

  return { success: true, data: credentials };
}

export async function createServiceCredentialAction(values: {
  serviceId: string;
  credentialName: string;
  username?: string;
  password?: string;
  loginUrl?: string;
  apiKey?: string;
  licenseKey?: string;
  secretNotes?: string;
  isClientVisible?: boolean;
}) {
  const user = await requireAdmin();
  const supabase = getAdmin();

  let protectedSecrets: {
    password: string | null;
    apiKey: string | null;
    licenseKey: string | null;
    secretNotes: string | null;
  };
  try {
    protectedSecrets = {
      password: values.password ? await protectCredential(values.password) : null,
      apiKey: values.apiKey ? await protectCredential(values.apiKey) : null,
      licenseKey: values.licenseKey ? await protectCredential(values.licenseKey) : null,
      secretNotes: values.secretNotes ? await protectCredential(values.secretNotes) : null,
    };
  } catch {
    return { success: false, error: "Approved credential secret provider is not configured." };
  }

  const { data: newCred, error } = await supabase
    .from("service_credentials")
    .insert({
      service_id: values.serviceId,
      credential_name: values.credentialName,
      username: values.username || null,
      encrypted_password: protectedSecrets.password,
      login_url: values.loginUrl || null,
      api_key: protectedSecrets.apiKey,
      license_key: protectedSecrets.licenseKey,
      secret_notes: protectedSecrets.secretNotes,
      is_client_visible: values.isClientVisible ?? false,
    })
    .select("id, service_id, credential_name, username, login_url, is_client_visible, created_at")
    .single();

  if (error || !newCred) {
    return { success: false, error: `Failed to store credential: ${error?.message}` };
  }

  // Log activity
  await supabase.from("service_activities").insert({
    service_id: values.serviceId,
    activity_type: "credential_updated",
    title: "Credentials Vault Updated",
    description: `Added credential record [${values.credentialName}].`,
    performed_by: user.fullName || user.email,
  });

  revalidatePath("/admin/services");
  revalidatePath("/client/services");

  return { success: true, data: newCred };
}

export async function toggleCredentialVisibilityAction(credentialId: string, isVisible: boolean) {
  await requireAdmin();
  const supabase = getAdmin();

  const { error } = await supabase
    .from("service_credentials")
    .update({ is_client_visible: isVisible, updated_at: new Date().toISOString() })
    .eq("id", credentialId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/admin/services");
  revalidatePath("/client/services");
  return { success: true };
}

export async function deleteServiceCredentialAction(credentialId: string) {
  await requireAdmin();
  const supabase = getAdmin();

  await supabase.from("service_credentials").delete().eq("id", credentialId);

  revalidatePath("/admin/services");
  revalidatePath("/client/services");
  return { success: true };
}

export async function getServiceActivitiesAction(serviceId: string) {
  const user = await requireClient();
  const supabase = user.role === "admin" ? getAdmin() : await createServerSupabaseClient() as any;

  const { data, error } = await supabase
    .from("service_activities")
    .select("*")
    .eq("service_id", serviceId)
    .order("created_at", { ascending: false });

  if (error) {
    return { success: false, error: error.message };
  }

  const activities = (data || []).map((a: any) => ({
    id: a.id,
    serviceId: a.service_id,
    type: a.activity_type,
    title: a.title,
    description: a.description,
    performedBy: a.performed_by || "System",
    timestamp: a.created_at,
  }));

  return { success: true, data: activities };
}

export async function extendServiceRenewalDateAction(serviceId: string, newRenewalDate: string, notes?: string) {
  await requireAdmin();
  const supabase = getAdmin();

  const { data: srv, error: findError } = await supabase
    .from("services")
    .select("id, name, renewal_date, metadata")
    .eq("id", serviceId)
    .single();

  if (findError || !srv) {
    return { success: false, error: "Service record not found." };
  }

  const formattedDate = new Date(newRenewalDate).toISOString();

  const { data: updated, error: updateError } = await supabase
    .from("services")
    .update({
      renewal_date: formattedDate,
      status: "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", serviceId)
    .select()
    .single();

  if (updateError) {
    return { success: false, error: `Failed to extend renewal date: ${updateError.message}` };
  }

  await supabase.from("service_activities").insert({
    service_id: serviceId,
    activity_type: "renewed",
    title: "Renewal Date Extended by Admin",
    description: `Renewal date extended to ${newRenewalDate}.${notes ? ` Notes: ${notes}` : ""}`,
    performed_by: "Admin",
  });

  revalidatePath("/admin/services");
  revalidatePath(`/admin/services/${serviceId}`);
  revalidatePath("/admin/clients");
  revalidatePath("/client/services");
  revalidatePath("/client/renewals");

  return { success: true, data: updated };
}


