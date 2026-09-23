import { revalidatePath } from "next/cache";

import { Button, Card, PageHeader, SectionTitle, cx, inputStyles } from "@/components/ui";
import { getDb } from "@/db";
import { settings } from "@/db/schema";
import { extractVariables } from "@/server/domain/templates";
import { getJob, listAllContacts } from "@/server/repository/jobs-repo";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  seedTemplatesIfEmpty,
  updateTemplate,
} from "@/server/repository/templates-repo";
import { Composer } from "./composer";

export const dynamic = "force-dynamic";

async function saveTemplate(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!name || !body) return;

  if (id) await updateTemplate(getDb(), id, name, body);
  else await createTemplate(getDb(), name, body);
  revalidatePath("/templates");
}

async function removeTemplate(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (id) await deleteTemplate(getDb(), id);
  revalidatePath("/templates");
}

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; edit?: string }>;
}) {
  const db = getDb();
  const params = await searchParams;

  // Seeded on first visit rather than by migration, so a template Sarthak deletes stays deleted.
  await seedTemplatesIfEmpty(db);

  const [templates, contacts, settingsRows, job] = await Promise.all([
    listTemplates(db),
    listAllContacts(db),
    db.select({ resumeUrl: settings.resumeUrl }).from(settings).limit(1),
    params.job ? getJob(db, params.job) : Promise.resolve(null),
  ]);

  const defaults: Record<string, string> = {
    resume_link: settingsRows[0]?.resumeUrl ?? "",
    your_name: "Akhilesh",
    ...(job
      ? { role: job.title, company: job.companyName, job_link: job.jobUrl }
      : {}),
  };

  // When composing for a specific job, that company's contacts come first.
  const orderedContacts = job
    ? [
        ...contacts.filter((c) => c.companyId === job.companyId),
        ...contacts.filter((c) => c.companyId !== job.companyId),
      ]
    : contacts;

  const editing = params.edit
    ? templates.find((t) => t.id === params.edit) ?? null
    : null;

  return (
    <div>
      <PageHeader
        title="Templates"
        subtitle={
          job ? (
            <>
              Composing for <span className="text-ink">{job.title}</span> at{" "}
              <span className="text-ink">{job.companyName}</span> — role, company and link are
              filled in.
            </>
          ) : (
            "Ask for a referral in two clicks. Variables are filled from the job and contact; the message stays editable."
          )
        }
      />

      <Composer
        templates={templates.map((t) => ({ id: t.id, name: t.name, body: t.body }))}
        contacts={orderedContacts.map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
          email: c.email,
          companyName: c.companyName,
        }))}
        defaults={defaults}
      />

      <section className="mt-10">
        <SectionTitle>Manage templates</SectionTitle>

        <div className="space-y-2">
          {templates.map((t) => {
            const vars = extractVariables(t.body);
            return (
              <Card key={t.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{t.name}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-ink-dim">{t.body}</p>
                    <p className="mt-1 text-[11px] text-ink-faint">
                      {vars.length > 0 ? vars.map((v) => `{{${v}}}`).join(" ") : "no variables"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <a
                      href={`/templates?edit=${t.id}`}
                      className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-ink-dim transition hover:border-line-strong hover:text-ink"
                    >
                      Edit
                    </a>
                    <form action={removeTemplate}>
                      <input type="hidden" name="id" value={t.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-ink-faint transition hover:border-danger/50 hover:text-danger"
                      >
                        Delete
                      </button>
                    </form>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        <Card className="mt-4 px-5 py-5">
          <p className="mb-3 text-[13px] font-medium text-ink">
            {editing ? `Edit “${editing.name}”` : "New template"}
          </p>
          <form action={saveTemplate} className="space-y-3">
            <input type="hidden" name="id" value={editing?.id ?? ""} />
            <input
              name="name"
              defaultValue={editing?.name ?? ""}
              placeholder="Template name"
              required
              className={inputStyles}
            />
            <textarea
              name="body"
              defaultValue={editing?.body ?? ""}
              rows={8}
              required
              placeholder={"Hi {{name}}, I saw a {{role}} opening at {{company}} — {{job_link}}"}
              className={cx(inputStyles, "resize-y leading-relaxed")}
            />
            <p className="text-[11px] text-ink-faint">
              Available variables: {"{{name}} {{company}} {{role}} {{job_link}} {{resume_link}} {{your_name}}"}.
              They are detected from the text, so adding one needs no other change.
            </p>
            <div className="flex gap-2">
              <Button type="submit" variant="primary">
                {editing ? "Save changes" : "Create template"}
              </Button>
              {editing && (
                <a
                  href="/templates"
                  className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[13px] text-ink-dim transition hover:border-line-strong hover:text-ink"
                >
                  Cancel
                </a>
              )}
            </div>
          </form>
        </Card>
      </section>
    </div>
  );
}
