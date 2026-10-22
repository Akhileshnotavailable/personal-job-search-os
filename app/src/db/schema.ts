/**
 * Database schema (Cloudflare D1 / SQLite).
 *
 * Design notes that matter:
 *  - Job identity is `UNIQUE (company_id, external_job_id)`. This constraint is what makes
 *    re-ingesting the same crawl a no-op, so duplicate jobs are impossible at the database level
 *    rather than merely unlikely in code. See docs/decisions/005-job-deduplication.md.
 *  - Notifications are an outbox with a `UNIQUE dedup_key`, so a duplicate email is likewise
 *    unrepresentable. See docs/decisions/007-ingest-boundary-and-notification-outbox.md.
 *  - Jobs are never hard-deleted when they vanish from a crawl; `closedAt` is set only after
 *    `missingRunCount` exceeds a threshold across *successful* runs, so a broken adapter cannot
 *    wipe the board. See docs/decisions/008-crawler-correctness-strategy.md.
 *  - JSON is stored as TEXT (SQLite has no JSONB). Columns holding JSON are typed via
 *    `.$type<T>()` so callers get real types, with parsing handled in the repository layer.
 */

import { sql } from "drizzle-orm";

import type { FitBand, FitSignal } from "@/server/domain/fit";
import type { CompanyMatchOverrides } from "@/server/domain/matching";
import {
  DEFAULT_THRESHOLDS,
  type ReminderKind,
  type ReminderThresholds,
} from "@/server/domain/reminders";
import {
  type AnySQLiteColumn,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import {
  DEFAULT_MATCH_RULES,
  type MatchRules,
} from "../server/domain/matching";

const uuid = () => crypto.randomUUID();

/** Unix-epoch-millisecond timestamp, defaulting to now. */
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

/** Which adapter handles a company. Mirrors the tier ladder in docs/crawlers.md. */
export type SourceType =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "workday"
  // Config-driven adapters: a field map in scripts/company_sources.json, not form fields.
  | "json_api"
  | "hydration"
  | "html_list"
  | "custom_json"
  | "jsonld"
  | "html"
  | "manual"
  | "linkedin_email";

/** Which LinkedIn feed a job came from. Drives the three sections on /linkedin. */
export type LinkedinFeed = "search" | "recommended" | "alert";

/**
 * Everything company-specific that can be data, is data — so adding a tier 1-2 company is a row,
 * not a code change (PRD §97). Shape varies by source type; adapters validate their own slice.
 */
export type SourceConfig = {
  /** greenhouse */
  boardToken?: string;
  /** lever / ashby */
  slug?: string;
  /** smartrecruiters */
  companyId?: string;
  /** workday: tenant, data-centre shard (wd1/wd3/wd5...), and site slug */
  tenant?: string;
  dataCenter?: string;
  site?: string;
  /** html / jsonld fallbacks */
  listSelector?: string;
  titleSelector?: string;
  urlSelector?: string;
  /** free-form escape hatch for custom adapters */
  [key: string]: unknown;
};

export type HealthStatus =
  | "unknown"
  | "healthy"
  | "degraded"
  | "suspicious"
  | "failing";

export const companies = sqliteTable(
  "companies",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    name: text("name").notNull(),
    websiteUrl: text("website_url"),
    careersUrl: text("careers_url"),

    sourceType: text("source_type").$type<SourceType>().notNull(),
    /** 1 = most stable (ATS feed) ... 6 = manual. See docs/crawlers.md. */
    sourceTier: integer("source_tier").notNull().default(6),
    sourceConfig: text("source_config", { mode: "json" })
      .$type<SourceConfig>()
      .notNull()
      .default({}),

    /**
     * Company-specific title vocabulary, e.g. `{"levelTitles": ["senior software engineer"]}`.
     *
     * Job ladders are not comparable across companies: Sarthak's level is "SDE II" at Amazon,
     * "Senior Software Engineer" at Confluent and "Software Engineer III" at Google. A global
     * rule set cannot express that, so each company carries its own vocabulary as data — no
     * deploy needed to teach the matcher a new ladder. See domain/matching.ts.
     */
    matchOverrides: text("match_overrides", { mode: "json" })
      .$type<CompanyMatchOverrides>(),

    active: integer("active", { mode: "boolean" }).notNull().default(true),

    /**
     * Zero results is an error by default. A genuinely empty board must opt in, otherwise a
     * silently broken adapter is indistinguishable from "no openings".
     */
    allowZeroResults: integer("allow_zero_results", { mode: "boolean" })
      .notNull()
      .default(false),

    /** Conditional-request cache keys; a 304 short-circuits the whole company. */
    etag: text("etag"),
    lastModified: text("last_modified"),
    /** Hash of the last raw listing response; identical hash skips parsing and ingest. */
    lastContentHash: text("last_content_hash"),

    lastCrawledAt: integer("last_crawled_at", { mode: "timestamp_ms" }),
    lastSuccessAt: integer("last_success_at", { mode: "timestamp_ms" }),
    healthStatus: text("health_status")
      .$type<HealthStatus>()
      .notNull()
      .default("unknown"),
    lastError: text("last_error"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("companies_name_unique").on(t.name),
    index("companies_active_idx").on(t.active),
    index("companies_health_idx").on(t.healthStatus),
  ],
);

// ---------------------------------------------------------------------------
// Referral contacts — intentionally minimal. This is not a CRM (PRD §10).
// ---------------------------------------------------------------------------

export const contacts = sqliteTable(
  "contacts",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    /** Referrals often start on LinkedIn rather than a phone number, so it is a first-class
     *  field rather than something buried in notes. */
    linkedinUrl: text("linkedin_url"),
    /**
     * This contact genuinely shares a phone number with someone else.
     *
     * The duplicate-number check exists because a mistyped number is otherwise invisible — it
     * once sent a Swiggy referral request into Google HR's chat. But sharing is sometimes real
     * (a shared work phone, one person known by two names), and an alarm that cannot be
     * silenced is one you stop reading, which would cost exactly the bug it was added to catch.
     */
    sharedNumberOk: integer("shared_number_ok", { mode: "boolean" })
      .notNull()
      .default(false),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("contacts_company_idx").on(t.companyId)],
);

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    /**
     * The source's own stable requisition id. Never synthesised, never derived from a title —
     * an unstable value here means every crawl looks new and the notifications become noise.
     */
    externalJobId: text("external_job_id").notNull(),

    title: text("title").notNull(),
    location: text("location"),
    department: text("department"),
    description: text("description"),

    jobUrl: text("job_url").notNull(),
    /** Lowercased host, query and fragment stripped — the fallback dedup key. */
    normalizedJobUrl: text("normalized_job_url").notNull(),

    /**
     * The same opening as seen on LinkedIn, when it was found there too.
     *
     * These are columns rather than a `job_sources` table on purpose. There is exactly one
     * alternate source and the only thing the UI does with it is render one "also on LinkedIn"
     * link, so a join table would be machinery bought for a second source that does not exist.
     * A LinkedIn id here is LinkedIn's own numeric posting id, never a synthesised one.
     */
    linkedinJobId: text("linkedin_job_id"),
    linkedinUrl: text("linkedin_url"),

    /** A real date or null. Never a display string like "Posted Today". */
    postedAt: integer("posted_at", { mode: "timestamp_ms" }),
    discoveredAt: integer("discovered_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),

    source: text("source").$type<SourceType>().notNull(),
    employmentType: text("employment_type"),
    rawMetadata: text("raw_metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),

    /** Relevance is computed server-side at ingest, from settings keywords. */
    isRelevant: integer("is_relevant", { mode: "boolean" })
      .notNull()
      .default(false),
    matchScore: integer("match_score").notNull().default(0),
    /** Human-readable explanation, so every decision is auditable in the UI. */
    matchReason: text("match_reason"),
    /**
     * Rank of the matched location in Sarthak's preference order
     * (1 Bangalore, 2 Gurgaon, 3 Remote, 4 Hyderabad). Null when the posting gave no location.
     * Stored explicitly rather than inferred from matchScore so the board can sort by
     * location preference and recency independently.
     */
    locationPriority: integer("location_priority"),

    /**
     * Fit against Sarthak's resume, 0-100, computed at ingest by domain/fit.ts. Distinct from
     * matchScore, which decides whether a job belongs on the board at all: fit ranks the ones
     * that already qualify. Stored rather than computed on read so the board can sort by it in
     * SQL, and so a profile change is a visible, deliberate re-score rather than a silent shift.
     */
    fitScore: integer("fit_score").notNull().default(0),
    fitBand: text("fit_band").$type<FitBand>(),
    /** The named signals behind the score, so the UI never shows a number it cannot justify. */
    fitSignals: text("fit_signals", { mode: "json" }).$type<FitSignal[]>(),
    /**
     * True when the source published no description and the score rests on the title alone.
     * Surfaced in the UI because "we could not assess this" and "this is a poor match" are
     * different statements, and a score alone cannot tell them apart.
     */
    fitTitleOnly: integer("fit_title_only", { mode: "boolean" }).notNull().default(false),

    /** Absence tracking — see the deletion-grace rule in ADR 008. */
    /**
     * Marked as read: seen and consciously passed over, without entering the pipeline.
     *
     * Distinct from `closedAt` (the posting is gone) and from an application stage (you acted on
     * it). Without this the board has no way to say "I have looked at this one", so the same
     * fifty roles read as new every morning and the genuinely new ones stop standing out.
     */
    readAt: integer("read_at", { mode: "timestamp_ms" }),

    missingRunCount: integer("missing_run_count").notNull().default(0),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // The one identity constraint, and what makes re-ingestion a no-op.
    uniqueIndex("jobs_company_external_unique").on(t.companyId, t.externalJobId),
    // NOT unique, deliberately. The normalized URL is a *fallback* identity: adapters for
    // sources with no stable requisition id derive external_job_id from it, so the constraint
    // above still covers them. Enforcing URL uniqueness independently is wrong -- Greenhouse
    // boards legitimately share one path across every posting, distinguished only by a query
    // parameter, so it rejected 869 of Databricks' 870 jobs. Kept as a plain index for lookups.
    index("jobs_company_url_idx").on(t.companyId, t.normalizedJobUrl),
    index("jobs_relevant_idx").on(t.isRelevant),
    index("jobs_discovered_idx").on(t.discoveredAt),
    index("jobs_company_idx").on(t.companyId),
    index("jobs_closed_idx").on(t.closedAt),
  ],
);

// ---------------------------------------------------------------------------
// Applications — exactly five stages (PRD §30). Do not add more.
// ---------------------------------------------------------------------------

export const APPLICATION_STATUSES = [
  "saved",
  "requested",
  "referred",
  "applied",
  "interviews",
  "selected",
  "rejected",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const applications = sqliteTable(
  "applications",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    status: text("status").$type<ApplicationStatus>().notNull().default("saved"),
    notes: text("notes"),

    /** Only timestamps that drive behaviour. requestedAt powers follow-up reminders. */
    requestedAt: integer("requested_at", { mode: "timestamp_ms" }),
    referredAt: integer("referred_at", { mode: "timestamp_ms" }),
    appliedAt: integer("applied_at", { mode: "timestamp_ms" }),
    /** When the process ended, either way. Both outcomes stamp this. */
    closedOutAt: integer("closed_out_at", { mode: "timestamp_ms" }),

    interviewStartedAt: integer("interview_started_at", {
      mode: "timestamp_ms",
    }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One application per job — the Kanban card *is* the job's pipeline state.
    uniqueIndex("applications_job_unique").on(t.jobId),
    index("applications_status_idx").on(t.status),
    index("applications_requested_idx").on(t.requestedAt),
  ],
);

// ---------------------------------------------------------------------------
// Message templates
// ---------------------------------------------------------------------------

export const templates = sqliteTable("templates", {
  id: text("id").primaryKey().$defaultFn(uuid),
  name: text("name").notNull(),
  /** Body with {{variable}} placeholders; variables are detected, not declared. */
  body: text("body").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Notification outbox
// ---------------------------------------------------------------------------

export type NotificationType = "new_job" | "follow_up" | "crawler_health";
export type NotificationStatus = "pending" | "sent" | "failed";

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey().$defaultFn(uuid),

    /**
     * Makes a duplicate notification impossible at the database level.
     * e.g. "new_job:{jobId}" or "follow_up:{applicationId}:{nthReminder}".
     */
    dedupKey: text("dedup_key").notNull(),

    notificationType: text("notification_type")
      .$type<NotificationType>()
      .notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),

    channel: text("channel").notNull().default("email"),
    status: text("status")
      .$type<NotificationStatus>()
      .notNull()
      .default("pending"),

    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),

    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("notifications_dedup_unique").on(t.dedupKey),
    index("notifications_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// Settings — single row (id = 1). Keywords live here, not in code, so changing
// them takes effect immediately with no crawler redeploy.
// ---------------------------------------------------------------------------

/**
 * A digest email exactly as it was sent.
 *
 * The notifications table records *what was queued*; this records *what landed in the inbox* —
 * the real subject line, the real body, the recipient and the moment it went out. Reconstructing
 * that from the notification rows would be a guess that drifts the first time the template
 * changes, and "what did that 06:30 email actually say" is precisely the question this needs to
 * answer.
 */
export const emailDigests = sqliteTable("email_digests", {
  id: text("id").primaryKey().$defaultFn(uuid),
  subject: text("subject").notNull(),
  bodyText: text("body_text").notNull(),
  recipient: text("recipient"),
  /** How many notifications this one email covered. */
  notificationCount: integer("notification_count").notNull().default(0),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: createdAt(),
});

export type EmailDigest = typeof emailDigests.$inferSelect;

/**
 * A reminder the user has closed.
 *
 * Reminders are computed, never stored, so "close this" needs somewhere to live. The row records
 * *when* it was dismissed, and a reminder is suppressed only while that moment is at or after the
 * state it was raised about — so if the job then moves stage, the clock restarts later than the
 * dismissal and the reminder legitimately returns. Closing something is therefore "not now",
 * not "never again", and it cannot silently hide a genuinely new situation.
 */
export const reminderDismissals = sqliteTable(
  "reminder_dismissals",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    /** Which reminder rule was closed; a job can raise different kinds over its life. */
    kind: text("kind").$type<ReminderKind>().notNull(),
    dismissedAt: integer("dismissed_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("reminder_dismissal_unique").on(t.jobId, t.kind)],
);

export type ReminderDismissal = typeof reminderDismissals.$inferSelect;

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),

  resumeUrl: text("resume_url"),
  notifyEmail: text("notify_email"),

  /**
   * The matching rule set: title patterns, experience bounds, and location allow-list with
   * ranking. Stored as data so Sarthak can retune what counts as a match without a code change
   * or a crawler redeploy, and so existing jobs can be re-matched retroactively.
   * See src/server/domain/matching.ts.
   */
  matchRules: text("match_rules", { mode: "json" })
    .$type<MatchRules>()
    .notNull()
    .default(DEFAULT_MATCH_RULES),

  /** Days in "requested" before a referral follow-up is surfaced (PRD §33). */
  followUpDays: integer("follow_up_days").notNull().default(5),

  /**
   * How long each kind of silence is tolerated before it becomes a reminder.
   *
   * Data, not code, for the same reason the match rules are: the right number for "referred but
   * not applied" is a judgement about how Sarthak works, and it should be changeable without a
   * deploy or a re-derivation of the rules that read it.
   */
  reminderThresholds: text("reminder_thresholds", { mode: "json" })
    .$type<ReminderThresholds>()
    .notNull()
    .default(DEFAULT_THRESHOLDS),
  /** Consecutive successful runs a job must be absent from before it is closed. */
  closeAfterMissingRuns: integer("close_after_missing_runs")
    .notNull()
    .default(3),

  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Crawl runs — per-company observability. Powers the health UI and drift detection.
// ---------------------------------------------------------------------------

export type CrawlStatus =
  | "success"
  | "failed"
  | "suspicious"
  | "degraded"
  | "skipped";

export const crawlRuns = sqliteTable(
  "crawl_runs",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    /** Groups all per-company rows from a single scheduled execution. */
    runId: text("run_id").notNull(),
    companyId: text("company_id").references(() => companies.id, {
      onDelete: "cascade",
    }),

    status: text("status").$type<CrawlStatus>().notNull(),
    tier: integer("tier"),

    jobsFound: integer("jobs_found").notNull().default(0),
    newJobs: integer("new_jobs").notNull().default(0),
    durationMs: integer("duration_ms"),
    /** Populated on skip (304 Not Modified, or unchanged content hash). */
    skipReason: text("skip_reason"),
    error: text("error"),

    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("crawl_runs_company_idx").on(t.companyId),
    index("crawl_runs_run_idx").on(t.runId),
    index("crawl_runs_started_idx").on(t.startedAt),
  ],
);

// ---------------------------------------------------------------------------

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type Settings = typeof settings.$inferSelect;
export type CrawlRun = typeof crawlRuns.$inferSelect;
export type NewCrawlRun = typeof crawlRuns.$inferInsert;

// ---------------------------------------------------------------------------
// Phase 1 — interview preparation
// ---------------------------------------------------------------------------

/**
 * One table for all three preparation disciplines rather than three tables.
 *
 * DSA questions, system design problems and behavioural stories share most of what matters --
 * a title, the companies that ask it, your notes, and whether you have actually done it. What
 * differs is the *shape of the answer*: a DSA question wants an approach and complexity, a
 * system design wants requirements and trade-offs, a behavioural story wants situation and
 * outcome. That difference lives in a JSON `content` column.
 *
 * This is what PRD §45 asks for -- room for low-level design, Golang, databases and
 * company-specific rounds without a rewrite. Adding a discipline is a new `kind`, not a
 * migration. And when Sarthak's Notion export arrives (PRD §39), importing it means mapping
 * fields into `content` rather than reshaping the schema around it.
 */
export const PREP_KINDS = ["dsa", "system_design", "behavioral", "concept", "company"] as const;
export type PrepKind = (typeof PREP_KINDS)[number];

export const PREP_STATUSES = ["not_started", "in_progress", "done", "revisit"] as const;
export type PrepStatus = (typeof PREP_STATUSES)[number];

export const PREP_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type PrepDifficulty = (typeof PREP_DIFFICULTIES)[number];

/** Discipline-specific fields. Every key optional: a row only fills what its kind needs. */
export type PrepContent = {
  /** dsa (freeform note pages) */
  approach?: string;
  complexity?: string;
  pattern?: string;
  /**
   * dsa (a fully worked question page, rendered by its own template instead of the generic
   * editor). Split into fields rather than one Markdown body because the code for a section has
   * to render *between* its steps and its complexity, not below everything in a separate panel --
   * a single Markdown blob has no seam to embed a component into.
   */
  problemSummary?: string;
  examples?: string;
  bruteForceIntuition?: string;
  bruteForceSteps?: string;
  bruteForceTimeComplexity?: string;
  bruteForceSpaceComplexity?: string;
  optimizedIntuition?: string;
  optimizedSteps?: string;
  optimizedTimeComplexity?: string;
  optimizedSpaceComplexity?: string;
  /**
   * dsa (alternate shape, for a question whose real answer is "N genuinely different
   * approaches" rather than one brute force and one optimized solution -- e.g. four pivot
   * strategies for Quicksort. Mutually exclusive with the brute/optimized fields above: a page
   * uses one shape or the other, never both, since each approach here carries its own
   * intuition/steps/complexity/code exactly like a brute-force-or-optimized section would.
   */
  approaches?: {
    title: string;
    /** Path into prep_code_files, e.g. "approach-1-last-element-pivot.cpp". */
    codeFile: string;
    intuition: string;
    steps: string;
    timeComplexity: string;
    spaceComplexity: string;
  }[];
  /** dsa: an optional closing table comparing the approaches above (Markdown). */
  comparisonTable?: string;
  /** dsa: an optional closing "what to say in the interview" section (Markdown). */
  interviewNotes?: string;
  /** system_design */
  requirements?: string;
  architecture?: string;
  tradeoffs?: string;
  /** behavioral */
  situation?: string;
  action?: string;
  outcome?: string;
  /** shared */
  references?: { label: string; url: string }[];

  /**
   * A page can be something other than a document.
   *
   * These three turn one into a reader instead. Keeping them in `content` rather than adding
   * columns means such a page is still an ordinary row -- it sits in the tree, drags, nests and
   * carries progress like any other, which is the whole reason the tree is one table.
   */
  /** A PDF under app/public, e.g. "/books/system-design-interview-vol-1.pdf". */
  pdf?: string;
  /**
   * A Google Drive share link or file id, streamed through `/api/books/[id]`.
   *
   * Preferred over `pdf` for anything large. A gitignored file under `public/` only exists on
   * the machine that put it there, so a deploy from CI ships without it and the book 404s;
   * Drive is reachable from wherever the deploy runs.
   */
  drive?: string;
  /** A site to embed. Only works where the site does not forbid framing. */
  embed?: string;
  /** "owner/repo" whose Markdown is fetched and rendered in place. */
  github?: string;

  [key: string]: unknown;
};

export const prepItems = sqliteTable(
  "prep_items",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    kind: text("kind").$type<PrepKind>().notNull(),
    /** URL-safe identifier, stable across edits so links do not rot. */
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    prompt: text("prompt"),

    difficulty: text("difficulty").$type<PrepDifficulty>(),
    /** 1-5, how often this comes up in interviews. Drives the default sort. */
    frequency: integer("frequency").notNull().default(0),

    /** JSON arrays. At a few hundred rows, filtering these in the service layer is cheaper
     *  than the join tables a relational purist would reach for -- and D1 counts queries. */
    topics: text("topics", { mode: "json" }).$type<string[]>().notNull().default([]),
    companies: text("companies", { mode: "json" }).$type<string[]>().notNull().default([]),

    /**
     * Parent page, making prep a tree rather than three flat lists.
     *
     * Folders and pages are the same row, exactly as in Notion: a page that has children reads
     * as a folder, and one that does not reads as a document. A separate `folders` table would
     * have forced every query to union two shapes and still could not express a folder holding
     * both notes and sub-folders, which is the normal case in an imported Notion directory.
     */
    parentId: text("parent_id").references((): AnySQLiteColumn => prepItems.id, {
      onDelete: "cascade",
    }),

    /** Where this sits among its siblings. Import order, then hand-arranged. */
    position: integer("position").notNull().default(0),

    /**
     * The page itself, as Markdown.
     *
     * The structured `content` fields above answer a fixed set of questions and stay useful for
     * DSA and behavioral, where the shape of a good answer is known. An imported HLD note has no
     * such shape -- it is a document -- so it gets a document, editable as the text it already is.
     */
    body: text("body"),

    status: text("status").$type<PrepStatus>().notNull().default("not_started"),
    notes: text("notes"),
    solution: text("solution"),
    content: text("content", { mode: "json" }).$type<PrepContent>().notNull().default({}),
    sourceUrl: text("source_url"),

    lastPracticedAt: integer("last_practiced_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    /**
     * Unique per parent, not per kind.
     *
     * A tree legitimately repeats a name: this export has a "Questions" page under the root and
     * another under RDBMS, and "consistent hashing" under both RDBMS and Questions. Paths
     * resolve level by level, so those are distinct pages and the old kind-wide index rejected
     * the import outright.
     *
     * `coalesce` because SQLite treats NULLs in a unique index as all distinct, which would
     * have quietly allowed two root folders both called "hld".
     *
     * drizzle-kit cannot serialise this expression -- it splits the index on the comma inside
     * `coalesce` and emits invalid SQL -- so migration 0016 is hand-written and authoritative.
     * Check any regenerated migration that touches this index before applying it.
     */
    uniqueIndex("prep_kind_parent_slug_unique").on(
      t.kind,
      sql`coalesce(${t.parentId}, '')`,
      t.slug,
    ),
    index("prep_kind_idx").on(t.kind),
    index("prep_status_idx").on(t.status),
    index("prep_frequency_idx").on(t.frequency),
    index("prep_parent_idx").on(t.parentId),
  ],
);

export type PrepItem = typeof prepItems.$inferSelect;
export type NewPrepItem = typeof prepItems.$inferInsert;

/**
 * A LinkedIn posting at a company that is not in `companies`.
 *
 * Sarthak curates the company list by hand, so a job alert must never be able to add to it --
 * an alert surfaces dozens of companies a week and auto-creating them would turn a deliberate
 * list of ~50 into an unusable one. But discarding those jobs would throw away most of what an
 * alert is *for*: the roles at companies not yet on the radar.
 *
 * So they wait here. A lead carries the company as free text, is never matched, never notified
 * on, and never counted anywhere. Promoting one is an explicit click that creates the company
 * and re-ingests the job through the normal path, at which point the lead is deleted.
 */
export const linkedinLeads = sqliteTable(
  "linkedin_leads",
  {
    id: text("id").primaryKey().$defaultFn(uuid),

    /** LinkedIn's own numeric posting id, taken from /jobs/view/<id>/. */
    linkedinJobId: text("linkedin_job_id").notNull(),
    /** Free text, exactly as the alert email spelled it. Not a foreign key by design. */
    companyName: text("company_name").notNull(),

    title: text("title").notNull(),
    location: text("location"),
    jobUrl: text("job_url").notNull(),

    /** Which LinkedIn feed produced this: the saved search, the recommendations, an alert. */
    feed: text("feed").$type<LinkedinFeed>().notNull(),

    postedAt: integer("posted_at", { mode: "timestamp_ms" }),
    discoveredAt: integer("discovered_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),

    /** Hidden by hand. Kept rather than deleted so the same alert cannot resurface it. */
    dismissedAt: integer("dismissed_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    // The same posting arrives in several alerts and on several days. One row per posting.
    uniqueIndex("linkedin_lead_job_unique").on(t.linkedinJobId),
    index("linkedin_lead_discovered_idx").on(t.discoveredAt),
    index("linkedin_lead_company_idx").on(t.companyName),
  ],
);

export type LinkedinLead = typeof linkedinLeads.$inferSelect;
export type NewLinkedinLead = typeof linkedinLeads.$inferInsert;

export const PREP_RESOURCE_KINDS = ["video", "article", "book"] as const;
export type PrepResourceKind = (typeof PREP_RESOURCE_KINDS)[number];

/**
 * Videos and posts pinned to a prep page.
 *
 * A table rather than a JSON array on the page, because these are added and removed one at a
 * time from the UI: a JSON column would mean read-modify-write on every change, which loses an
 * edit whenever two happen close together.
 *
 * `kind` decides how it renders -- a video embeds and plays in place, an article is a card --
 * and is derived from the URL when one is pasted, so nothing has to be classified by hand.
 */
export const prepResources = sqliteTable(
  "prep_resources",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    prepItemId: text("prep_item_id")
      .notNull()
      .references(() => prepItems.id, { onDelete: "cascade" }),

    kind: text("kind").$type<PrepResourceKind>().notNull().default("article"),
    url: text("url").notNull(),
    title: text("title").notNull(),
    /** Who made it -- "Hello Interview", "Gaurav Sen". Shown so you can pick by author. */
    source: text("source"),
    /** YouTube id, when the URL is a video. Kept so the embed never re-parses the URL. */
    videoId: text("video_id"),

    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    // The same link pasted twice on one page is a mistake, not a second resource.
    uniqueIndex("prep_resource_item_url_unique").on(t.prepItemId, t.url),
    index("prep_resource_item_idx").on(t.prepItemId),
  ],
);

export type PrepResource = typeof prepResources.$inferSelect;
export type NewPrepResource = typeof prepResources.$inferInsert;

/**
 * The production code for a design question, as a small file tree.
 *
 * A table rather than an array in `content`, for the same reason `prep_resources` is one: files
 * are added and removed one at a time, so a JSON column would mean read-modify-write on every
 * change and would lose an edit whenever two landed close together. It also keeps whole source
 * files out of the row that every tree and listing query already reads.
 *
 * `path` is the full path inside the workspace ("src/model/Vehicle.java"). The folder tree the
 * UI draws is derived from those strings rather than stored, so there is no second structure
 * that can disagree with the files themselves -- moving a file is rewriting one string, and an
 * empty folder simply cannot exist.
 */
export const prepCodeFiles = sqliteTable(
  "prep_code_files",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    prepItemId: text("prep_item_id")
      .notNull()
      .references(() => prepItems.id, { onDelete: "cascade" }),

    /** Full path inside the workspace, e.g. "src/model/Vehicle.java". No leading slash. */
    path: text("path").notNull(),
    /** highlight.js language id. Derived from the extension when not supplied. */
    language: text("language"),
    content: text("content").notNull(),

    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One row per path per question: adding the same path twice is a correction, not a copy.
    uniqueIndex("prep_code_file_item_path_unique").on(t.prepItemId, t.path),
    index("prep_code_file_item_idx").on(t.prepItemId),
  ],
);

export type PrepCodeFile = typeof prepCodeFiles.$inferSelect;
export type NewPrepCodeFile = typeof prepCodeFiles.$inferInsert;

/**
 * Somebody else's notes, kept so the page does not depend on GitHub being in a good mood.
 *
 * The notes pages used to fetch from GitHub on every single view. Two API calls per view --
 * one for the default branch, one for the recursive tree -- against an anonymous budget of 60
 * per hour *per egress IP*, and a Worker's egress IP belongs to Cloudflare and is shared with
 * everything else running there. `next: { revalidate }` did not help: this deployment runs
 * with no incremental cache (see `open-next.config.ts`), so the hint had nowhere to store
 * anything and every render went back out to the network. Hence a cache we actually own.
 *
 * One row per fetched thing: the tree of a repository, or the body of one file. `fetchedAt`
 * drives the TTL, and a stale row is still served if the refresh fails -- notes that are a day
 * old beat an error page.
 */
export const githubNotesCache = sqliteTable("github_notes_cache", {
  /** "<owner>/<repo>" for a tree, "<owner>/<repo>:<path>" for a file body. */
  key: text("key").primaryKey(),
  /** JSON for a tree, raw Markdown for a file. */
  payload: text("payload").notNull(),
  /** Recorded alongside the tree so a file fetch does not have to ask GitHub for it again. */
  branch: text("branch"),
  fetchedAt: integer("fetched_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type GithubNotesCacheRow = typeof githubNotesCache.$inferSelect;
