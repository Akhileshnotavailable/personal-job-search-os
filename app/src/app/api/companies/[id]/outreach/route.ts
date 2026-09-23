import { getDb } from "@/db";
import { settings } from "@/db/schema";
import { contactsForCompany } from "@/server/repository/jobs-repo";
import { listTemplates } from "@/server/repository/templates-repo";

/**
 * GET /api/companies/[id]/outreach
 *
 * Everything the message modal needs, fetched when it opens.
 *
 * This used to be passed down as props to every job card. Because the modal is a client
 * component, React had to serialise the full contact list, every template body and the settings
 * defaults once *per card* — 200 copies of the same payload on a full board, which is what made
 * /jobs a 1.8 MB response. Fetching on open costs one small request at the moment you actually
 * want it, and nothing at all the other 199 times.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const db = getDb();

  const [contacts, templates, settingsRows] = await Promise.all([
    contactsForCompany(db, id),
    listTemplates(db),
    db.select({ resumeUrl: settings.resumeUrl }).from(settings).limit(1),
  ]);

  return Response.json({
    contacts,
    templates: templates.map((t) => ({ id: t.id, name: t.name, body: t.body })),
    defaults: {
      resume_link: settingsRows[0]?.resumeUrl ?? "",
      your_name: "Akhilesh",
    },
  });
}

// The row this reads is per-company and changes when contacts or templates do, so it must not
// be cached at the edge.
export const dynamic = "force-dynamic";
