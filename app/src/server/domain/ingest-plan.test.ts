import { describe, expect, it } from "vitest";

import { DEFAULT_MATCH_RULES } from "./matching";
import {
  planIngest,
  type ExistingJob,
  type IncomingJob,
  type PlanInput,
} from "./ingest-plan";

function job(overrides: Partial<IncomingJob> = {}): IncomingJob {
  return {
    externalJobId: "R-1",
    title: "Product Designer",
    jobUrl: "https://x.com/j/1",
    normalizedJobUrl: "https://x.com/j/1",
    location: "Bengaluru, India",
    description: "3+ years of experience.",
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingJob> = {}): ExistingJob {
  return {
    id: "job-1",
    externalJobId: "R-1",
    isRelevant: true,
    missingRunCount: 0,
    closedAt: null,
    ...overrides,
  };
}

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    reportedStatus: "success",
    seenExternalIds: ["R-1"],
    jobs: [job()],
    existing: [],
    rules: DEFAULT_MATCH_RULES,
    allowZeroResults: false,
    hasSeenJobsBefore: true,
    closeAfterMissingRuns: 3,
    recentMedianCount: null,
    isFinal: true,
    ...overrides,
  };
}

describe("planIngest — creating jobs", () => {
  it("creates a new relevant job and queues exactly one notification", () => {
    const p = planIngest(input());
    expect(p.status).toBe("success");
    expect(p.createdExternalIds).toEqual(["R-1"]);
    expect(p.notifications).toHaveLength(1);
    expect(p.notifications[0].dedupKey).toBe("new_job:R-1");
  });

  it("creates a new irrelevant job WITHOUT queueing a notification", () => {
    const p = planIngest(
      input({ jobs: [job({ title: "Senior Software Engineer" })] }),
    );
    expect(p.createdExternalIds).toEqual(["R-1"]);
    expect(p.upserts[0].isRelevant).toBe(false);
    expect(p.notifications).toHaveLength(0);
  });

  it("stores an explanation for every job, relevant or not", () => {
    const p = planIngest(
      input({
        jobs: [job(), job({ externalJobId: "R-2", title: "Staff Engineer" })],
        seenExternalIds: ["R-1", "R-2"],
      }),
    );
    for (const u of p.upserts) expect(u.matchReason.length).toBeGreaterThan(0);
  });
});

describe("planIngest — idempotency", () => {
  // The guarantee behind "no duplicate referral emails" (PRD §64).
  it("re-ingesting an unchanged crawl creates nothing and notifies nobody", () => {
    const first = planIngest(input());
    expect(first.createdExternalIds).toHaveLength(1);
    expect(first.notifications).toHaveLength(1);

    // Second run: the job now exists.
    const second = planIngest(input({ existing: [existing()] }));
    expect(second.createdExternalIds).toHaveLength(0);
    expect(second.notifications).toHaveLength(0);
    expect(second.missingJobIds).toHaveLength(0);
    // It is still upserted, so match changes propagate.
    expect(second.upserts).toHaveLength(1);
    expect(second.upserts[0].existingId).toBe("job-1");
  });

  it("does not re-notify when an existing job becomes relevant after a rules change", () => {
    // Notifications are for NEW jobs only. A job that flips to relevant is visible on the
    // board; re-notifying would reopen the duplicate-email problem.
    const p = planIngest(input({ existing: [existing({ isRelevant: false })] }));
    expect(p.notifications).toHaveLength(0);
  });
});

describe("planIngest — the zero-result guard", () => {
  it("marks an unexpectedly empty crawl suspicious rather than successful", () => {
    const p = planIngest(input({ seenExternalIds: [], jobs: [] }));
    expect(p.status).toBe("suspicious");
    expect(p.statusReason).toContain("zero jobs");
  });

  it("does not touch presence state on a suspicious run", () => {
    const p = planIngest(
      input({ seenExternalIds: [], jobs: [], existing: [existing()] }),
    );
    expect(p.presenceTrackingSkipped).toBe(true);
    expect(p.missingJobIds).toHaveLength(0);
    expect(p.closeJobIds).toHaveLength(0);
  });

  it("accepts an empty crawl when the company opted in", () => {
    const p = planIngest(
      input({ seenExternalIds: [], jobs: [], allowZeroResults: true }),
    );
    expect(p.status).toBe("success");
  });

  it("accepts an empty crawl from a company that has never returned jobs", () => {
    const p = planIngest(
      input({ seenExternalIds: [], jobs: [], hasSeenJobsBefore: false }),
    );
    expect(p.status).toBe("success");
  });
});

describe("planIngest — failed runs never mutate presence", () => {
  it.each(["failed", "skipped", "degraded", "suspicious"] as const)(
    "a %s run closes nothing",
    (status) => {
      const p = planIngest(
        input({
          reportedStatus: status,
          seenExternalIds: [],
          jobs: [],
          existing: [existing({ missingRunCount: 2 })],
        }),
      );
      expect(p.presenceTrackingSkipped).toBe(true);
      expect(p.missingJobIds).toHaveLength(0);
      expect(p.closeJobIds).toHaveLength(0);
      expect(p.upserts).toHaveLength(0);
    },
  );
});

describe("planIngest — deletion grace", () => {
  it("marks a vanished job missing but does not close it immediately", () => {
    const p = planIngest(
      input({
        seenExternalIds: ["R-2"],
        jobs: [job({ externalJobId: "R-2" })],
        existing: [existing({ id: "old", externalJobId: "R-1", missingRunCount: 0 })],
      }),
    );
    expect(p.missingJobIds).toEqual(["old"]);
    expect(p.closeJobIds).toHaveLength(0);
  });

  it("closes only after the configured number of consecutive successful misses", () => {
    const p = planIngest(
      input({
        seenExternalIds: ["R-2"],
        jobs: [job({ externalJobId: "R-2" })],
        existing: [existing({ id: "old", externalJobId: "R-1", missingRunCount: 2 })],
        closeAfterMissingRuns: 3,
      }),
    );
    expect(p.closeJobIds).toEqual(["old"]);
  });

  it("ignores jobs that are already closed", () => {
    const p = planIngest(
      input({
        seenExternalIds: [],
        jobs: [],
        allowZeroResults: true,
        existing: [existing({ id: "old", closedAt: new Date() })],
      }),
    );
    expect(p.missingJobIds).toHaveLength(0);
  });

  it("uses the full observed id set, not just the filtered records", () => {
    // R-1 was seen but filtered out by the crawler's title gate. It must NOT look missing --
    // otherwise every non-matching job at a company would slowly be closed.
    const p = planIngest(
      input({
        seenExternalIds: ["R-1", "R-2"],
        jobs: [job({ externalJobId: "R-2" })],
        existing: [existing({ id: "old", externalJobId: "R-1" })],
      }),
    );
    expect(p.missingJobIds).toHaveLength(0);
  });
});

describe("planIngest — volume drift", () => {
  it("flags a large drop against the recent median as degraded", () => {
    const p = planIngest(
      input({
        seenExternalIds: ["R-1"],
        jobs: [job()],
        recentMedianCount: 100,
      }),
    );
    expect(p.status).toBe("degraded");
    expect(p.statusReason).toContain("below half");
  });

  it("leaves a normal fluctuation alone", () => {
    const p = planIngest(
      input({
        seenExternalIds: Array.from({ length: 90 }, (_, i) => `R-${i}`),
        jobs: [job({ externalJobId: "R-0" })],
        recentMedianCount: 100,
      }),
    );
    expect(p.status).toBe("success");
  });

  it("still ingests jobs on a degraded run", () => {
    const p = planIngest(input({ recentMedianCount: 100 }));
    expect(p.status).toBe("degraded");
    expect(p.upserts).toHaveLength(1);
  });
});

describe("planIngest — reappearing jobs", () => {
  it("resets the missing counter when a previously-absent job comes back", () => {
    const p = planIngest(
      input({ existing: [existing({ id: "old", missingRunCount: 2 })] }),
    );
    expect(p.resetMissingJobIds).toEqual(["old"]);
    expect(p.closeJobIds).toHaveLength(0);
  });

  it("does not bother resetting a job whose counter is already zero", () => {
    const p = planIngest(input({ existing: [existing({ missingRunCount: 0 })] }));
    expect(p.resetMissingJobIds).toHaveLength(0);
  });
});

describe("planIngest — chunked crawls", () => {
  it("does not track presence on a non-final chunk", () => {
    // A partial chunk has an incomplete id set. Acting on it would close live jobs.
    const p = planIngest(
      input({
        isFinal: false,
        seenExternalIds: ["R-2"],
        jobs: [job({ externalJobId: "R-2" })],
        existing: [existing({ id: "old", externalJobId: "R-1" })],
      }),
    );
    expect(p.presenceTrackingSkipped).toBe(true);
    expect(p.missingJobIds).toHaveLength(0);
    expect(p.closeJobIds).toHaveLength(0);
  });

  it("still ingests jobs and queues notifications on a non-final chunk", () => {
    const p = planIngest(input({ isFinal: false }));
    expect(p.upserts).toHaveLength(1);
    expect(p.notifications).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Chunked runs
// ---------------------------------------------------------------------------

describe("a non-final chunk is not a measurement of the board", () => {
  // Regression, and the costliest kind: silent job loss. Every chunk but the last carries an
  // empty seenExternalIds by design, so the zero-result guard fired on it and returned the
  // empty plan -- discarding that chunk's jobs. Amazon is the only company large enough to
  // chunk today and also the source of most relevant matches, so a genuinely new SDE-2 role
  // could sit undiscovered until it happened to land in the final chunk.
  it("keeps the jobs a non-final chunk carries", () => {
    const p = planIngest(
      input({ isFinal: false, seenExternalIds: [], jobs: [job({ externalJobId: "R-9" })] }),
    );
    expect(p.upserts).toHaveLength(1);
    expect(p.createdExternalIds).toEqual(["R-9"]);
  });

  it("still notifies for a relevant new job found in a non-final chunk", () => {
    const p = planIngest(
      input({ isFinal: false, seenExternalIds: [], jobs: [job({ externalJobId: "R-9" })] }),
    );
    expect(p.notifications).toHaveLength(1);
  });

  it("does not call a non-final chunk suspicious", () => {
    const p = planIngest(input({ isFinal: false, seenExternalIds: [] }));
    expect(p.status).toBe("success");
    expect(p.statusReason).toBeNull();
  });

  it("does not call a non-final chunk degraded on volume drift", () => {
    const p = planIngest(input({ isFinal: false, seenExternalIds: [], recentMedianCount: 2000 }));
    expect(p.status).toBe("success");
  });

  it("never touches presence state on a non-final chunk", () => {
    const p = planIngest(
      input({ isFinal: false, seenExternalIds: [], existing: [existing({ id: "old" })] }),
    );
    expect(p.presenceTrackingSkipped).toBe(true);
    expect(p.missingJobIds).toEqual([]);
    expect(p.closeJobIds).toEqual([]);
  });

  it("still flags a genuinely empty board when the final chunk says so", () => {
    const p = planIngest(input({ isFinal: true, seenExternalIds: [], jobs: [] }));
    expect(p.status).toBe("suspicious");
    expect(p.upserts).toEqual([]);
  });

  it("still flags volume drift on the final chunk", () => {
    const p = planIngest(input({ isFinal: true, recentMedianCount: 2000 }));
    expect(p.status).toBe("degraded");
  });
});
