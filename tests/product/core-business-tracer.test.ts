import assert from "node:assert/strict";
import test from "node:test";

import {
  CoreBusinessTracer,
  type BusinessSliceRepository,
  type TenantBusinessState,
} from "../../src/server/product/core-business-tracer.ts";

class MemoryBusinessRepository implements BusinessSliceRepository {
  private readonly states = new Map<string, TenantBusinessState>();

  async load(tenantId: string): Promise<TenantBusinessState> {
    return structuredClone(
      this.states.get(tenantId) ?? {
        tenantId,
        version: 0,
        clients: [],
        invitations: [],
        assignments: [],
        invoices: [],
        payments: [],
        tickets: [],
        audit: [],
      },
    );
  }

  async save(state: TenantBusinessState, expectedVersion: number): Promise<void> {
    const current = this.states.get(state.tenantId);
    assert.equal(current?.version ?? 0, expectedVersion, "optimistic version");
    this.states.set(state.tenantId, structuredClone(state));
  }
}

const admin = { userId: "admin-1", tenantId: "tenant-a", role: "admin" as const };
const clientActor = { userId: "user-client-1", tenantId: "tenant-a", role: "client" as const };

test("orchestrates the complete admin-to-client business tracer with an audit trail", async () => {
  const tracer = new CoreBusinessTracer(new MemoryBusinessRepository(), {
    now: () => new Date("2026-08-29T00:00:00.000Z"),
    id: (() => {
      let sequence = 0;
      return (prefix: string) => `${prefix}-${++sequence}`;
    })(),
  });

  const created = await tracer.createClient(admin, {
    tenantId: "tenant-a",
    email: "client@example.test",
    displayName: "Example Client",
  });
  await tracer.acceptInvitation(clientActor, {
    tenantId: "tenant-a",
    invitationToken: created.invitationToken,
  });
  const assignment = await tracer.assignService(admin, {
    tenantId: "tenant-a",
    clientId: created.clientId,
    serviceCode: "BOOKKEEPING",
  });
  const invoice = await tracer.issueInvoice(admin, {
    tenantId: "tenant-a",
    clientId: created.clientId,
    assignmentId: assignment.assignmentId,
    amountMinor: 125_00,
    currency: "USD",
  });

  const visibleInvoice = await tracer.viewInvoice(clientActor, {
    tenantId: "tenant-a",
    invoiceId: invoice.invoiceId,
  });
  assert.equal(visibleInvoice.amountMinor, 125_00);
  assert.equal(visibleInvoice.status, "issued");

  await tracer.recordPayment(admin, {
    tenantId: "tenant-a",
    invoiceId: invoice.invoiceId,
    amountMinor: 125_00,
    currency: "USD",
    reference: "manual-receipt-1",
  });
  const ticket = await tracer.openSupportTicket(clientActor, {
    tenantId: "tenant-a",
    subject: "Receipt question",
    body: "Please confirm the receipt is available.",
  });
  const audit = await tracer.getAuditTrail(admin, { tenantId: "tenant-a" });

  assert.match(ticket.ticketId, /^ticket-/);
  assert.deepEqual(
    audit.map((entry) => entry.action),
    [
      "client.created",
      "invitation.accepted",
      "service.assigned",
      "invoice.issued",
      "invoice.viewed",
      "payment.recorded",
      "support_ticket.opened",
    ],
  );
  assert.ok(audit.every((entry) => entry.tenantId === "tenant-a"));
});

test("rejects an expired client invitation", async () => {
  let now = new Date("2026-08-29T00:00:00.000Z");
  let sequence = 0;
  const tracer = new CoreBusinessTracer(new MemoryBusinessRepository(), {
    now: () => now,
    id: (prefix: string) => `${prefix}-${++sequence}`,
  });
  const created = await tracer.createClient(admin, {
    tenantId: "tenant-a",
    email: "late-client@example.test",
    displayName: "Late Client",
  });

  now = new Date("2026-08-31T00:00:01.000Z");

  await assert.rejects(
    tracer.acceptInvitation(clientActor, {
      tenantId: "tenant-a",
      invitationToken: created.invitationToken,
    }),
    { code: "CONFLICT", message: "Invitation has expired." },
  );
});

test("denies an admin command when the actor belongs to another tenant", async () => {
  const tracer = new CoreBusinessTracer(new MemoryBusinessRepository(), {
    now: () => new Date("2026-08-29T00:00:00.000Z"),
    id: (prefix: string) => `${prefix}-1`,
  });

  await assert.rejects(
    tracer.createClient(
      { userId: "admin-b", tenantId: "tenant-b", role: "admin" },
      { tenantId: "tenant-a", email: "client@example.test", displayName: "Client" },
    ),
    { code: "FORBIDDEN" },
  );
});
