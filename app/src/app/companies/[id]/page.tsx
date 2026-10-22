import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";

import { Badge, Button, Card, PageHeader, SectionTitle, cx, inputStyles } from "@/components/ui";
import { getDb } from "@/db";
import { companies, crawlRuns, type SourceType } from "@/db/schema";
import { CONFIG_DRIVEN, describeConfig } from "@/server/domain/source-detect";
import { conflictingContactNumbers, contactsForCompany, listJobs } from "@/server/repository/jobs-repo";
import {
  acknowledgeSharedNumber,
  addContact,
  deleteCompany,
  deleteContact,
  updateCompany,
  updateContact,
} from "../actions";

export const dynamic = "force-dynamic";

const SOURCE_TYPES: SourceType[] = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workday",
  "manual",
];

/** Which config inputs each source type needs. Rendering all of them would invite filling in
 *  fields that the adapter then ignores. */
const CONFIG_FIELDS: Record<string, { key: string; label: string; hint: string }[]> = {
  greenhouse: [{ key: "boardToken", label: "Board token", hint: "boards.greenhouse.io/<token>" }],
  lever: [{ key: "slug", label: "Slug", hint: "jobs.lever.co/<slug>" }],
  ashby: [{ key: "slug", label: "Slug", hint: "jobs.ashbyhq.com/<slug>" }],
  smartrecruiters: [
    { key: "companyId", label: "Company ID", hint: "careers.smartrecruiters.com/<id>" },
  ],
  workday: [
    { key: "tenant", label: "Tenant", hint: "e.g. nvidia" },
    { key: "dataCenter", label: "Shard", hint: "e.g. wd5 — not guessable, read it off the URL" },
    { key: "site", label: "Site", hint: "e.g. NVIDIAExternalCareerSite" },
  ],
  manual: [],
};

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
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();

  const rows = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  const company = rows[0];
  if (!company) notFound();

  const [people, jobs, runs, numberConflicts] = await Promise.all([
    contactsForCompany(db, id),
    listJobs(db, { companyId: id, relevantOnly: false, limit: 10 }),
    db
      .select()
      .from(crawlRuns)
      .where(eq(crawlRuns.companyId, id))
      .orderBy(desc(crawlRuns.startedAt))
      .limit(5),
    conflictingContactNumbers(db),
  ]);

  const fields = CONFIG_FIELDS[company.sourceType] ?? [];
  const config = company.sourceConfig ?? {};

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={company.name}
        subtitle={
          <>
            {describeConfig(company.sourceType, config)}
            {" · "}
            <Link href={`/jobs?company=${id}&all=1`} className="hover:underline">
              {jobs.length} job{jobs.length === 1 ? "" : "s"} tracked
            </Link>
          </>
        }
        actions={
          <Link href="/companies" className="text-[13px] text-ink-dim transition hover:text-ink">
            ← Companies
          </Link>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone={HEALTH_TONE[company.healthStatus]}>{company.healthStatus}</Badge>
        {!company.active && <Badge tone="danger">Inactive</Badge>}
        <span className="text-[11px] text-ink-faint">
          last success {ago(company.lastSuccessAt)}
        </span>
        {company.careersUrl && (
          <a
            href={company.careersUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-[13px] text-accent-ink hover:underline"
          >
            Open careers page ↗
          </a>
        )}
      </div>

      {company.lastError && (
        <Card className="mb-6 border-danger/40 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-danger">Last error</p>
          <p className="mt-1 text-[13px] text-ink-dim">{company.lastError}</p>
        </Card>
      )}

      <SectionTitle>Source</SectionTitle>
      <Card className="mb-6 px-5 py-5">
        <form action={updateCompany} className="space-y-4">
          <input type="hidden" name="id" value={company.id} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-[13px] font-medium text-ink">Name</label>
              <input name="name" defaultValue={company.name} className={cx(inputStyles, "mt-1.5")} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-ink">Adapter</label>
              {/* A select with no option for the stored type silently selects the first one,
                  so saving this form re-typed a json_api company as greenhouse and erased its
                  field map. Config-driven sources are shown, not offered. */}
              {CONFIG_DRIVEN.has(company.sourceType) ? (
                <>
                  <input type="hidden" name="sourceType" value={company.sourceType} />
                  <p className={cx(inputStyles, "mt-1.5 text-ink-dim")}>{company.sourceType}</p>
                  <p className="mt-1 text-[11px] text-ink-faint">
                    Field map lives in scripts/company_sources.json
                  </p>
                </>
              ) : (
                <select
                  name="sourceType"
                  defaultValue={company.sourceType}
                  className={cx(inputStyles, "mt-1.5")}
                >
                  {SOURCE_TYPES.map((s) => (
                    <option key={s} value={s} className="bg-surface-2">
                      {s}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-ink">Careers URL</label>
            <input
              name="careersUrl"
              defaultValue={company.careersUrl ?? ""}
              placeholder="https://…"
              className={cx(inputStyles, "mt-1.5")}
            />
          </div>

          {/* Job ladders are not comparable across companies, and a global rule cannot express
              that. Without this, Confluent's "Senior Software Engineer" — Sarthak's actual
              level there — was dropped by the global `senior` rule before he ever saw it. */}
          <div>
            <label className="block text-[13px] font-medium text-ink">
              Level titles at this company
            </label>
            <p className="mb-1 mt-0.5 text-[11px] leading-relaxed text-ink-faint">
              What this company calls your level — one per line. e.g.{" "}
              <span className="text-ink-dim">Senior Software Engineer</span> at Confluent,{" "}
              <span className="text-ink-dim">Software Engineer III</span> at Google. These lift
              the seniority filter for this company only; sales, QA, security and hardware roles
              stay excluded regardless.
            </p>
            <textarea
              name="levelTitles"
              rows={3}
              defaultValue={(company.matchOverrides?.levelTitles ?? []).join("\n")}
              placeholder={"Senior Software Engineer\nSoftware Engineer III"}
              className={cx(inputStyles, "mt-1.5 font-mono text-[12px]")}
            />
          </div>

          {fields.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-3">
              {fields.map((f) => (
                <div key={f.key}>
                  <label className="block text-[13px] font-medium text-ink">{f.label}</label>
                  <p className="mb-1 mt-0.5 text-[11px] text-ink-faint">{f.hint}</p>
                  <input
                    name={f.key}
                    defaultValue={String(config[f.key] ?? "")}
                    className={inputStyles}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-5 pt-1">
            <label className="flex items-center gap-2 text-[13px] text-ink-dim">
              <input type="checkbox" name="active" defaultChecked={company.active} />
              Crawl this company
            </label>
            <label className="flex items-center gap-2 text-[13px] text-ink-dim">
              <input
                type="checkbox"
                name="allowZeroResults"
                defaultChecked={company.allowZeroResults}
              />
              Allow zero results
            </label>
          </div>
          <p className="text-[11px] leading-relaxed text-ink-faint">
            Zero results is treated as an error by default — a board that returns nothing is
            indistinguishable from a broken adapter. Only tick that box for a company whose
            board is genuinely empty.
          </p>

          <Button type="submit" variant="primary">
            Save source
          </Button>
        </form>
      </Card>

      <SectionTitle>Referral contacts</SectionTitle>
      <Card className="mb-6 px-5 py-5">
        {people.length === 0 ? (
          <p className="mb-4 text-[13px] text-ink-dim">
            No contacts here yet — which is normal for plenty of companies.
          </p>
        ) : (
          <ul className="mb-5 space-y-3">
            {people.map((c) => (
              <li key={c.id} className="border-b border-line/60 pb-3 last:border-0 last:pb-0">
                <form action={updateContact} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="companyId" value={company.id} />
                  <input name="name" defaultValue={c.name} className={inputStyles} />
                  <input
                    name="phone"
                    defaultValue={c.phone ?? ""}
                    placeholder="Phone"
                    className={inputStyles}
                  />
                  <input
                    name="email"
                    defaultValue={c.email ?? ""}
                    placeholder="Email"
                    className={inputStyles}
                  />
                  {/* Referrals often start on LinkedIn rather than a phone number, and the
                      message modal already sends there — without this input the field was
                      reachable only from the Add Company form. */}
                  <input
                    name="linkedinUrl"
                    defaultValue={c.linkedinUrl ?? ""}
                    placeholder="LinkedIn"
                    className={inputStyles}
                  />
                  {/* A shared number across *different names* is nearly always a typo, and it
                      is otherwise invisible: the message goes where you stored it, and the only
                      clue is the chat opening under someone else's name. */}
                  {numberConflicts.get(c.id)?.length ? (
                    <p className="col-span-full text-[11px] text-warn">
                      This number is also saved for{" "}
                      {numberConflicts
                        .get(c.id)!
                        .map((o) => `${o.name} at ${o.companyName}`)
                        .join(", ")}
                      .{" "}
                      <span className="text-ink-faint">
                        If that is genuinely the same number, say so and this stops asking.
                      </span>
                    </p>
                  ) : null}
                  {numberConflicts.get(c.id)?.length ? (
                    <button
                      type="submit"
                      formAction={acknowledgeSharedNumber}
                      name="id"
                      value={c.id}
                      className="col-span-full justify-self-start rounded px-1 text-[11px] text-ink-faint underline-offset-2 transition hover:text-ink-dim hover:underline"
                    >
                      That number is correct
                    </button>
                  ) : null}
                  <div className="flex gap-1.5">
                    <button
                      type="submit"
                      className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-ink-dim transition hover:border-line-strong hover:text-ink"
                    >
                      Save
                    </button>
                  </div>
                </form>
                <form action={deleteContact} className="mt-1">
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="companyId" value={company.id} />
                  <button
                    type="submit"
                    className="text-[11px] text-ink-faint transition hover:text-danger"
                  >
                    Remove {c.name}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <form action={addContact} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
          <input type="hidden" name="companyId" value={company.id} />
          <input name="name" placeholder="Name" required className={inputStyles} />
          <input name="phone" placeholder="Phone" className={inputStyles} />
          <input name="email" placeholder="Email" className={inputStyles} />
          <input name="linkedinUrl" placeholder="LinkedIn" className={inputStyles} />
          <Button type="submit" variant="primary">
            Add
          </Button>
        </form>
      </Card>

      {runs.length > 0 && (
        <>
          <SectionTitle>Recent crawls</SectionTitle>
          <Card className="mb-6 overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Found</th>
                  <th className="px-4 py-2 font-medium">New</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r, i) => (
                  <tr key={r.id} className={cx(i > 0 && "border-t border-line/60")}>
                    <td className="px-4 py-2 text-ink-faint">{ago(r.startedAt)}</td>
                    <td className="px-4 py-2">
                      <Badge
                        tone={
                          r.status === "success"
                            ? "fresh"
                            : r.status === "failed"
                              ? "danger"
                              : "warn"
                        }
                      >
                        {r.status}
                      </Badge>
                    </td>
                    <td className="tnum px-4 py-2 text-ink-dim">{r.jobsFound}</td>
                    <td className="tnum px-4 py-2 text-ink-dim">{r.newJobs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      <Card className="border-danger/30 px-5 py-4">
        <p className="text-[13px] font-medium text-ink">Remove company</p>
        <p className="mb-3 mt-0.5 text-[11px] text-ink-faint">
          Deletes its jobs and contacts too. To stop crawling without losing history, untick
          &ldquo;Crawl this company&rdquo; above instead.
        </p>
        <form action={deleteCompany}>
          <input type="hidden" name="id" value={company.id} />
          <button
            type="submit"
            className="rounded-md border border-danger/40 px-3 py-1.5 text-[13px] text-danger transition hover:bg-danger-soft"
          >
            Delete {company.name}
          </button>
        </form>
      </Card>
    </div>
  );
}
