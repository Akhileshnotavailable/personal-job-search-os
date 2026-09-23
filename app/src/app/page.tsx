import Link from "next/link";

import { CompanyGroup } from "@/components/company-group";
import { JobCard, type JobRow } from "@/components/job-card";
import { Badge, Card, EmptyState, PageHeader, SectionTitle, Stat } from "@/components/ui";
import { ReminderList } from "@/components/reminder-list";
import { getDb } from "@/db";
import { settings } from "@/db/schema";
import {
  buildReminders,
  DEFAULT_THRESHOLDS,
  type ReminderCandidate,
} from "@/server/domain/reminders";
import {
  contactsByCompany,
  reminderDismissalMap,
  jobStats,
  listCompanyHealth,
  listJobs,
  listRecentlyDiscovered,
  listReminderCandidates,
} from "@/server/repository/jobs-repo";

export const dynamic = "force-dynamic";

const HEALTH_TONE = {
  healthy: "fresh",
  degraded: "warn",
  suspicious: "warn",
  failing: "danger",
  unknown: "neutral",
} as const;

function ago(date: Date | null): string {
  if (!date) return "never";
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** "Since you last looked" for someone who looks most days. */
const RECENT_DAYS = 3;

export default async function DashboardPage() {
  const db = getDb();
  const [stats, top, health, recent, reminderRows, settingsRows, contacts, dismissed] =
    await Promise.all([
    jobStats(db),
    listJobs(db, { sort: "best", limit: 8, unreadOnly: true }),
    listCompanyHealth(db),
    listRecentlyDiscovered(db, RECENT_DAYS, 40),
    listReminderCandidates(db),
    db.select({ reminderThresholds: settings.reminderThresholds }).from(settings).limit(1),
    contactsByCompany(db),
    reminderDismissalMap(db),
  ]);

  const reminders = buildReminders(
    reminderRows.map((r) => ({ ...r, hasContact: Boolean(r.hasContact) })) as ReminderCandidate[],
    { ...DEFAULT_THRESHOLDS, ...(settingsRows[0]?.reminderThresholds ?? {}) },
    new Date(),
    dismissed,
  );
  const overdueCount = reminders.filter((r) => r.severity === "overdue").length;

  // Chosen by fit — that is what makes them "top" — but shown newest-posted first, because
  // among roles that all match well, the one published yesterday is the one still worth a
  // referral ask. Undated postings sink rather than sorting as epoch zero.
  const topByPosted = [...(top as unknown as JobRow[])].sort(
    (a, b) => (b.postedAt?.getTime() ?? -Infinity) - (a.postedAt?.getTime() ?? -Infinity),
  );

  // The same outreach payload the job board passes down, so a card behaves identically wherever
  // it appears. A card that acts differently depending on the page is a card you have to think
  // about before clicking.
  const outreachFor = (companyId: string) => ({
    contactCount: (contacts.get(companyId) ?? []).length,
  });

  // The same company stacks as the board, so "what arrived" reads the way "what is open" does:
  // one card per company, best fit first, and a referral ask is one conversation rather than
  // four scattered rows.
  const recentGroups = (() => {
    const groups = new Map<string, { name: string; jobs: JobRow[] }>();
    for (const job of recent as unknown as JobRow[]) {
      const g = groups.get(job.companyId);
      if (g) g.jobs.push(job);
      else groups.set(job.companyId, { name: job.companyName, jobs: [job] });
    }
    return [...groups.entries()]
      .map(([id, g]) => ({
        id,
        name: g.name,
        jobs: [...g.jobs].sort(
          (a, b) =>
            (b.postedAt?.getTime() ?? -Infinity) - (a.postedAt?.getTime() ?? -Infinity),
        ),
      }))
      .sort(
        (a, b) =>
          (b.jobs[0]?.postedAt?.getTime() ?? -Infinity) -
          (a.jobs[0]?.postedAt?.getTime() ?? -Infinity),
      );
  })();

  const automated = health.filter((c) => c.active && c.sourceType !== "manual");
  const needsAttention = automated.filter(
    (c) => c.healthStatus !== "healthy" && c.healthStatus !== "unknown",
  );
  const manual = health.filter((c) => c.active && c.sourceType === "manual");
  const lastCrawl = automated
    .map((c) => c.lastSuccessAt)
    .filter(Boolean)
    .sort((a, b) => (b as Date).getTime() - (a as Date).getTime())[0] as Date | undefined;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={
          <>
            What needs attention today. Last successful crawl {ago(lastCrawl ?? null)}.
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Matching roles"
          value={Number(stats.relevant ?? 0)}
          hint="open and relevant"
          tone="fresh"
        />
        <Stat
          label="Found in 3 days"
          value={Number(stats.recent ?? 0)}
          hint="new matches"
        />
        <Stat label="Jobs tracked" value={Number(stats.total ?? 0)} hint="all sources" />
        <Stat
          label="Sources healthy"
          value={`${automated.length - needsAttention.length}/${automated.length}`}
          hint="automated crawlers"
          tone={needsAttention.length ? "warn" : "neutral"}
        />
      </div>

      {needsAttention.length > 0 && (
        <section className="mt-8">
          <SectionTitle>Needs attention</SectionTitle>
          <ul className="space-y-1.5">
            {needsAttention.map((c) => (
              <Card as="li" key={c.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-ink">{c.name}</span>
                  {c.lastError && (
                    <p className="mt-0.5 text-xs text-ink-dim">{c.lastError}</p>
                  )}
                </div>
                <Badge tone={HEALTH_TONE[c.healthStatus]}>{c.healthStatus}</Badge>
              </Card>
            ))}
          </ul>
        </section>
      )}

      {reminders.length > 0 && (
        <section className="mt-8">
          <SectionTitle
            action={
              <Link
                href="/reminders"
                className="text-[13px] text-ink-dim transition hover:text-ink"
              >
                All {reminders.length} →
              </Link>
            }
          >
            Waiting on you{overdueCount > 0 && ` · ${overdueCount} overdue`}
          </SectionTitle>
          <ReminderList reminders={reminders} limit={4} />
        </section>
      )}

      {/* What appeared since you last looked. Separate from "top matches" because the whole
          premise of the crawler is reaching a posting while a referral is still worth asking
          for -- a role found today is a different opportunity from the same role found a
          fortnight ago, even at an identical fit score. */}
      <section className="mt-8">
        <SectionTitle
          action={
            <Link
              href="/jobs?sort=newest"
              className="text-[13px] text-ink-dim transition hover:text-ink"
            >
              View all →
            </Link>
          }
        >
          Found in the last {RECENT_DAYS} days{recent.length > 0 && ` · ${recent.length}`}
        </SectionTitle>
        {recent.length === 0 ? (
          <EmptyState
            title="Nothing new"
            body={`No new matching roles in the last ${RECENT_DAYS} days. The crawler runs twice a day, at 06:30 and 18:30.`}
          />
        ) : (
          <div className="space-y-3">
            {recentGroups.map((g) => (
              <CompanyGroup
                key={g.id}
                companyId={g.id}
                companyName={g.name}
                jobs={g.jobs}
                maxVisible={3}
                bestFit={Math.max(0, ...g.jobs.map((j) => j.fitScore))}
                outreach={outreachFor(g.id)}
                contactNames={(contacts.get(g.id) ?? []).map((c) => c.name)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <SectionTitle
          action={
            <Link href="/jobs" className="text-[13px] text-ink-dim transition hover:text-ink">
              View all →
            </Link>
          }
        >
          Top matches
        </SectionTitle>
        {top.length === 0 ? (
          <EmptyState
            title="No matching roles yet"
            body="The crawler runs every six hours and will surface Product Designer roles in Bangalore, Gurgaon, Remote or Hyderabad as they appear."
            hint={<code className="text-ink-dim">python -m crawler.main</code>}
          />
        ) : (
          <ul className="space-y-2">
            {topByPosted.map((job) => (
              <JobCard key={job.id} job={job} outreach={outreachFor(job.companyId)} />
            ))}
          </ul>
        )}
      </section>

      {manual.length > 0 && (
        <section className="mt-8">
          <SectionTitle>Check by hand · {manual.length}</SectionTitle>
          <Card className="px-4 py-3.5">
            <p className="text-xs text-ink-dim">
              These sources cannot be crawled automatically — they render listings in the
              browser, or decline automated access. Manual is a supported state, not a failure.
            </p>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {manual.map((c) =>
                c.careersUrl ? (
                  <li key={c.id}>
                    <a
                      href={c.careersUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[13px] text-ink-dim transition hover:border-line-strong hover:text-ink"
                    >
                      {c.name}
                      <span className="text-ink-faint">↗</span>
                    </a>
                  </li>
                ) : (
                  <li
                    key={c.id}
                    className="rounded-md border border-line px-2.5 py-1 text-[13px] text-ink-faint"
                  >
                    {c.name}
                  </li>
                ),
              )}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
