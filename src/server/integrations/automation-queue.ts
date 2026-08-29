export type AutomationJobInput = {
  tenantId: string;
  type: string;
  payload: Readonly<Record<string, unknown>>;
  idempotencyKey: string;
  runAt?: string;
};

export type ClaimedAutomationJob = AutomationJobInput & {
  jobId: string;
  attempt: number;
  leaseToken: string;
  leaseExpiresAt: string;
};

export interface DurableAutomationJobStore {
  /** Persist a job using a database uniqueness constraint on idempotencyKey. */
  enqueue(job: AutomationJobInput): Promise<{ jobId: string }>;
  /** Atomically claim due jobs with a persisted lease (for example FOR UPDATE SKIP LOCKED). */
  claimDue(input: { workerId: string; limit: number; leaseSeconds: number }): Promise<ClaimedAutomationJob[]>;
  /** Complete only when leaseToken still owns the durable row. */
  complete(jobId: string, leaseToken: string): Promise<void>;
  /** Persist error/attempt state and make the row retryable after retryAt. */
  fail(jobId: string, leaseToken: string, error: string, retryAt: string): Promise<void>;
}

export class AutomationQueue {
  private readonly store: DurableAutomationJobStore;
  private readonly config: { enabled: boolean };

  constructor(store: DurableAutomationJobStore, config: { enabled: boolean }) {
    this.store = store;
    this.config = config;
  }

  async enqueue(job: AutomationJobInput): Promise<{ enqueued: true; jobId: string } | { enqueued: false; code: "DISABLED" | "INVALID_JOB" }> {
    if (!this.config.enabled) return { enqueued: false, code: "DISABLED" };
    if (!job.tenantId || !job.type || !job.idempotencyKey) return { enqueued: false, code: "INVALID_JOB" };
    const result = await this.store.enqueue(job);
    return { enqueued: true, jobId: result.jobId };
  }
}
