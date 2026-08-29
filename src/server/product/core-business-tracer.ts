import { createHash } from "node:crypto";

export type BusinessActor = {
  userId: string;
  tenantId: string;
  role: "admin" | "client";
};

export type AuditEntry = {
  id: string;
  tenantId: string;
  actorId: string;
  action: string;
  entityId: string;
  occurredAt: string;
};

type Client = { id: string; email: string; displayName: string; userId?: string };
type Invitation = { id: string; clientId: string; tokenHash: string; expiresAt: string; acceptedAt?: string };
type Assignment = { id: string; clientId: string; serviceCode: string };
type Invoice = {
  id: string;
  clientId: string;
  assignmentId: string;
  amountMinor: number;
  currency: string;
  status: "issued" | "paid";
};
type Payment = { id: string; invoiceId: string; amountMinor: number; currency: string; reference: string };
type Ticket = { id: string; clientId: string; subject: string; body: string };

export type TenantBusinessState = {
  tenantId: string;
  version: number;
  clients: Client[];
  invitations: Invitation[];
  assignments: Assignment[];
  invoices: Invoice[];
  payments: Payment[];
  tickets: Ticket[];
  audit: AuditEntry[];
};

export interface BusinessSliceRepository {
  load(tenantId: string): Promise<TenantBusinessState>;
  save(state: TenantBusinessState, expectedVersion: number): Promise<void>;
}

export type TracerRuntime = {
  now(): Date;
  id(prefix: string): string;
};

export class BusinessRuleError extends Error {
  readonly code: "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT";

  constructor(
    code: "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "BusinessRuleError";
  }
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class CoreBusinessTracer {
  private readonly repository: BusinessSliceRepository;
  private readonly runtime: TracerRuntime;

  constructor(
    repository: BusinessSliceRepository,
    runtime: TracerRuntime,
  ) {
    this.repository = repository;
    this.runtime = runtime;
  }

  async createClient(actor: BusinessActor, input: { tenantId: string; email: string; displayName: string }) {
    this.authorize(actor, input.tenantId, "admin");
    const email = input.email.trim().toLowerCase();
    if (!email.includes("@") || input.displayName.trim().length === 0) {
      throw new BusinessRuleError("INVALID_INPUT", "A valid email and display name are required.");
    }

    return this.mutate(input.tenantId, async (state) => {
      if (state.clients.some((client) => client.email === email)) {
        throw new BusinessRuleError("CONFLICT", "A client with this email already exists.");
      }
      const clientId = this.runtime.id("client");
      const invitationId = this.runtime.id("invitation");
      const invitationToken = this.runtime.id("invitation-token");
      state.clients.push({ id: clientId, email, displayName: input.displayName.trim() });
      const expiresAt = new Date(this.runtime.now().getTime() + 48 * 60 * 60 * 1000).toISOString();
      state.invitations.push({ id: invitationId, clientId, tokenHash: tokenHash(invitationToken), expiresAt });
      this.audit(state, actor, "client.created", clientId);
      return { clientId, invitationId, invitationToken };
    });
  }

  async acceptInvitation(actor: BusinessActor, input: { tenantId: string; invitationToken: string }) {
    this.authorize(actor, input.tenantId, "client");
    return this.mutate(input.tenantId, async (state) => {
      const invitation = state.invitations.find((item) => item.tokenHash === tokenHash(input.invitationToken));
      if (!invitation) throw new BusinessRuleError("NOT_FOUND", "Invitation not found.");
      if (invitation.acceptedAt) throw new BusinessRuleError("CONFLICT", "Invitation has already been accepted.");
      if (this.runtime.now().getTime() > new Date(invitation.expiresAt).getTime()) {
        throw new BusinessRuleError("CONFLICT", "Invitation has expired.");
      }
      const client = state.clients.find((item) => item.id === invitation.clientId)!;
      invitation.acceptedAt = this.runtime.now().toISOString();
      client.userId = actor.userId;
      this.audit(state, actor, "invitation.accepted", invitation.id);
      return { clientId: client.id };
    });
  }

  async assignService(actor: BusinessActor, input: { tenantId: string; clientId: string; serviceCode: string }) {
    this.authorize(actor, input.tenantId, "admin");
    if (input.serviceCode.trim().length === 0) throw new BusinessRuleError("INVALID_INPUT", "Service code is required.");
    return this.mutate(input.tenantId, async (state) => {
      this.requireClient(state, input.clientId);
      const assignmentId = this.runtime.id("assignment");
      state.assignments.push({ id: assignmentId, clientId: input.clientId, serviceCode: input.serviceCode.trim() });
      this.audit(state, actor, "service.assigned", assignmentId);
      return { assignmentId };
    });
  }

  async issueInvoice(actor: BusinessActor, input: { tenantId: string; clientId: string; assignmentId: string; amountMinor: number; currency: string }) {
    this.authorize(actor, input.tenantId, "admin");
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || !/^[A-Z]{3}$/.test(input.currency)) {
      throw new BusinessRuleError("INVALID_INPUT", "Invoice amount and currency are invalid.");
    }
    return this.mutate(input.tenantId, async (state) => {
      this.requireClient(state, input.clientId);
      const assignment = state.assignments.find((item) => item.id === input.assignmentId && item.clientId === input.clientId);
      if (!assignment) throw new BusinessRuleError("NOT_FOUND", "Service assignment not found.");
      const invoiceId = this.runtime.id("invoice");
      state.invoices.push({ id: invoiceId, clientId: input.clientId, assignmentId: input.assignmentId, amountMinor: input.amountMinor, currency: input.currency, status: "issued" });
      this.audit(state, actor, "invoice.issued", invoiceId);
      return { invoiceId };
    });
  }

  async viewInvoice(actor: BusinessActor, input: { tenantId: string; invoiceId: string }) {
    this.authorize(actor, input.tenantId, "client");
    return this.mutate(input.tenantId, async (state) => {
      const client = state.clients.find((item) => item.userId === actor.userId);
      const invoice = state.invoices.find((item) => item.id === input.invoiceId && item.clientId === client?.id);
      if (!invoice) throw new BusinessRuleError("NOT_FOUND", "Invoice not found.");
      this.audit(state, actor, "invoice.viewed", invoice.id);
      return structuredClone(invoice);
    });
  }

  async recordPayment(actor: BusinessActor, input: { tenantId: string; invoiceId: string; amountMinor: number; currency: string; reference: string }) {
    this.authorize(actor, input.tenantId, "admin");
    return this.mutate(input.tenantId, async (state) => {
      const invoice = state.invoices.find((item) => item.id === input.invoiceId);
      if (!invoice) throw new BusinessRuleError("NOT_FOUND", "Invoice not found.");
      if (invoice.status === "paid") throw new BusinessRuleError("CONFLICT", "Invoice is already paid.");
      if (input.amountMinor !== invoice.amountMinor || input.currency !== invoice.currency || !input.reference.trim()) {
        throw new BusinessRuleError("INVALID_INPUT", "Payment must match the invoice and include a reference.");
      }
      const paymentId = this.runtime.id("payment");
      state.payments.push({ id: paymentId, invoiceId: invoice.id, amountMinor: input.amountMinor, currency: input.currency, reference: input.reference.trim() });
      invoice.status = "paid";
      this.audit(state, actor, "payment.recorded", paymentId);
      return { paymentId };
    });
  }

  async openSupportTicket(actor: BusinessActor, input: { tenantId: string; subject: string; body: string }) {
    this.authorize(actor, input.tenantId, "client");
    if (!input.subject.trim() || !input.body.trim()) throw new BusinessRuleError("INVALID_INPUT", "Ticket subject and body are required.");
    return this.mutate(input.tenantId, async (state) => {
      const client = state.clients.find((item) => item.userId === actor.userId);
      if (!client) throw new BusinessRuleError("FORBIDDEN", "Client identity is not linked to this tenant.");
      const ticketId = this.runtime.id("ticket");
      state.tickets.push({ id: ticketId, clientId: client.id, subject: input.subject.trim(), body: input.body.trim() });
      this.audit(state, actor, "support_ticket.opened", ticketId);
      return { ticketId };
    });
  }

  async getAuditTrail(actor: BusinessActor, input: { tenantId: string }): Promise<AuditEntry[]> {
    this.authorize(actor, input.tenantId, "admin");
    const state = await this.repository.load(input.tenantId);
    return structuredClone(state.audit);
  }

  private authorize(actor: BusinessActor, tenantId: string, role: BusinessActor["role"]): void {
    if (actor.tenantId !== tenantId || actor.role !== role) {
      throw new BusinessRuleError("FORBIDDEN", "Actor is not authorized for this tenant operation.");
    }
  }

  private requireClient(state: TenantBusinessState, clientId: string): Client {
    const client = state.clients.find((item) => item.id === clientId);
    if (!client) throw new BusinessRuleError("NOT_FOUND", "Client not found.");
    return client;
  }

  private audit(state: TenantBusinessState, actor: BusinessActor, action: string, entityId: string): void {
    state.audit.push({ id: this.runtime.id("audit"), tenantId: state.tenantId, actorId: actor.userId, action, entityId, occurredAt: this.runtime.now().toISOString() });
  }

  private async mutate<T>(tenantId: string, operation: (state: TenantBusinessState) => Promise<T>): Promise<T> {
    const state = await this.repository.load(tenantId);
    if (state.tenantId !== tenantId) throw new BusinessRuleError("FORBIDDEN", "Repository returned a cross-tenant state.");
    const expectedVersion = state.version;
    const result = await operation(state);
    state.version = expectedVersion + 1;
    await this.repository.save(state, expectedVersion);
    return result;
  }
}
