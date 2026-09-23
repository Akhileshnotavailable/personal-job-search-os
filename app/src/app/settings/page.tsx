import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { Badge, Button, Card, PageHeader, SectionTitle, inputStyles } from "@/components/ui";
import { getDb } from "@/db";
import { RunCrawl } from "./run-crawl";
import { settings } from "@/db/schema";
import {
  DEFAULT_THRESHOLDS,
  type ReminderThresholds,
} from "@/server/domain/reminders";

export const dynamic = "force-dynamic";

async function saveSettings(formData: FormData) {
  "use server";
  const db = getDb();
  const closeAfter = Number(formData.get("closeAfterMissingRuns") ?? 3);

  // One number per reminder rule. Clamped rather than rejected: a threshold of 0 would fire on
  // everything the moment it was saved, and a silently huge one would quietly switch the rule
  // off — both are worse than a value nudged back into a range that still means something.
  const days = (name: keyof ReminderThresholds, fallback: number) => {
    const raw = Number(formData.get(name));
    if (!Number.isFinite(raw)) return fallback;
    return Math.min(365, Math.max(1, Math.round(raw)));
  };
  const reminderThresholds: ReminderThresholds = {
    referralStatusDays: days("referralStatusDays", DEFAULT_THRESHOLDS.referralStatusDays),
    applyAfterReferralDays: days("applyAfterReferralDays", DEFAULT_THRESHOLDS.applyAfterReferralDays),
    decideOnSavedDays: days("decideOnSavedDays", DEFAULT_THRESHOLDS.decideOnSavedDays),
    applicationSilentDays: days("applicationSilentDays", DEFAULT_THRESHOLDS.applicationSilentDays),
    strongMatchDays: days("strongMatchDays", DEFAULT_THRESHOLDS.strongMatchDays),
  };

  await db
    .update(settings)
    .set({
      notifyEmail: String(formData.get("notifyEmail") ?? "").trim() || null,
      resumeUrl: String(formData.get("resumeUrl") ?? "").trim() || null,
      // Kept in step with the reminder rule of the same meaning, so the Applications follow-up
      // list and the Reminders page can never disagree about when a referral has gone quiet.
      followUpDays: reminderThresholds.referralStatusDays,
      reminderThresholds,
      closeAfterMissingRuns: Number.isFinite(closeAfter) ? closeAfter : 3,
      updatedAt: new Date(),
    })
    .where(eq(settings.id, 1));

  revalidatePath("/settings");
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-ink">{label}</label>
      {hint && <p className="mb-1.5 mt-0.5 text-xs text-ink-faint">{hint}</p>}
      {children}
    </div>
  );
}

/** One row per reminder rule, described in terms of what it watches rather than its field name. */
const REMINDER_FIELDS: {
  name: keyof ReminderThresholds;
  label: string;
  hint: string;
}[] = [
  {
    name: "referralStatusDays",
    label: "Chase a referral after (days)",
    hint: "Days in Requested with no reply. Also drives the Applications follow-up list.",
  },
  {
    name: "applyAfterReferralDays",
    label: "Apply after a referral within (days)",
    hint: "Someone has spent their credibility — deliberately the shortest window.",
  },
  {
    name: "decideOnSavedDays",
    label: "Decide on a saved role after (days)",
    hint: "Days in Saved with no decision either way.",
  },
  {
    name: "applicationSilentDays",
    label: "Application gone quiet after (days)",
    hint: "Days since applying with nothing recorded since.",
  },
  {
    name: "strongMatchDays",
    label: "Untouched strong match after (days)",
    hint: "Only excellent and strong fits qualify, so this never reproduces the job board.",
  },
];

export default async function SettingsPage() {
  const db = getDb();
  const rows = await db.select().from(settings).limit(1);
  const s = rows[0];
  // Fall back per-key so a settings row written before a rule existed still renders sensibly.
  const thresholds: ReminderThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...(s?.reminderThresholds ?? {}),
  };
  const rules = s?.matchRules;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Settings"
        subtitle="Match rules live in the database, so changing them takes effect on the next crawl without a deploy."
      />

      <SectionTitle>Run now</SectionTitle>
      <RunCrawl />

      <form action={saveSettings} className="space-y-6">
        <Card className="space-y-5 px-5 py-5">
          <SectionTitle>Notifications</SectionTitle>
          <Field
            label="Notification email"
            hint="Where the digest goes after each crawl. Without this, notifications queue but never send."
          >
            <input
              name="notifyEmail"
              type="email"
              defaultValue={s?.notifyEmail ?? ""}
              placeholder="you@example.com"
              className={inputStyles}
            />
          </Field>
          <Field label="Canonical resume link" hint="Used by message templates as {{resume_link}}.">
            <input
              name="resumeUrl"
              type="url"
              defaultValue={s?.resumeUrl ?? ""}
              placeholder="https://…"
              className={inputStyles}
            />
          </Field>
        </Card>

        <Card className="space-y-5 px-5 py-5">
          <SectionTitle>Reminder timing</SectionTitle>
          <p className="mb-3 text-[11px] leading-relaxed text-ink-faint">
            How long each kind of silence is tolerated before it becomes a reminder. Lower is
            pushier. These take effect immediately — reminders are computed on every page load,
            not stored.
          </p>
          <div className="mb-5 grid gap-5 sm:grid-cols-2">
            {REMINDER_FIELDS.map((f) => (
              <Field key={f.name} label={f.label} hint={f.hint}>
                <input
                  name={f.name}
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={thresholds[f.name]}
                  className={inputStyles}
                />
              </Field>
            ))}
          </div>

          <SectionTitle>Pipeline behaviour</SectionTitle>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Close after N missed crawls"
              hint="Only successful runs count, so a broken adapter can never close a live role."
            >
              <input
                name="closeAfterMissingRuns"
                type="number"
                min={1}
                max={20}
                defaultValue={s?.closeAfterMissingRuns ?? 3}
                className={inputStyles}
              />
            </Field>
          </div>
        </Card>

        <Button type="submit" variant="primary">
          Save changes
        </Button>
      </form>

      <Card className="mt-8 px-5 py-5">
        <SectionTitle>Active match rules</SectionTitle>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
          <dt className="text-ink-dim">Target level</dt>
          <dd className="text-ink">Product Designer / Senior Product Designer and close equivalents (UX/UI Designer)</dd>

          <dt className="text-ink-dim">Locations</dt>
          <dd className="flex flex-wrap gap-1.5">
            {(rules?.location.allow ?? [])
              .slice()
              .sort((a, b) => a.priority - b.priority)
              .map((l, i) => (
                <Badge key={l.name} tone={i === 0 ? "accent" : "neutral"}>
                  {l.priority}. {l.name}
                </Badge>
              ))}
          </dd>

          <dt className="text-ink-dim">Experience</dt>
          <dd className="text-ink">
            up to {rules?.experience.idealMaxYears ?? 4} years, rejected at{" "}
            {rules?.experience.hardRejectYears ?? 7}+
          </dd>

          <dt className="text-ink-dim">Patterns</dt>
          <dd className="tnum text-ink">
            {rules?.title.include.length ?? 0} include · {rules?.title.exclude.length ?? 0}{" "}
            exclude
          </dd>
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-ink-faint">
          Exclusions cover seniority above and below target, non-engineering roles, hardware and
          silicon, and — at your request — security and networking. Every job stores the reason
          it matched, so a filtering decision is always auditable rather than a black box.
        </p>
      </Card>
    </div>
  );
}
