"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { companies, contacts, type SourceConfig, type SourceType } from "@/db/schema";
import type { CompanyMatchOverrides } from "@/server/domain/matching";
import { CONFIG_DRIVEN, detectSource, validateConfig } from "@/server/domain/source-detect";

function revalidateCompany(id?: string) {
  revalidatePath("/companies");
  if (id) revalidatePath(`/companies/${id}`);
  revalidatePath("/");
}

/**
 * Add a company from a pasted careers URL.
 *
 * If the URL is recognised the adapter and config are filled in automatically; if not, the
 * company is saved as `manual` rather than guessed at. Manual is a supported state that shows
 * up as something to check by hand — a wrong adapter would just fail quietly.
 */
export async function addCompany(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const careersUrl = String(formData.get("careersUrl") ?? "").trim();
  if (!name) return;

  const detected = careersUrl ? detectSource(careersUrl) : null;
  const db = getDb();
  const companyId = crypto.randomUUID();

  await db
    .insert(companies)
    .values({
      id: companyId,
      name,
      careersUrl: careersUrl || null,
      sourceType: detected?.sourceType ?? "manual",
      sourceTier: detected?.sourceTier ?? 6,
      sourceConfig: detected?.config ?? {},
      matchOverrides: parseLevelTitles(String(formData.get("levelTitles") ?? "")),
      active: true,
    })
    .onConflictDoNothing();

  // A referral contact is the reason most of these companies are on the list at all, so it is
  // captured in the same step rather than as a second trip through the company page. Written
  // only when the insert above actually created the row, so re-adding an existing company
  // cannot silently attach a duplicate contact to it.
  const contactName = String(formData.get("contactName") ?? "").trim();
  if (contactName) {
    const created = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    if (created.length) {
      await db.insert(contacts).values({
        id: crypto.randomUUID(),
        companyId,
        name: contactName,
        phone: String(formData.get("contactPhone") ?? "").trim() || null,
        email: String(formData.get("contactEmail") ?? "").trim() || null,
        linkedinUrl: String(formData.get("contactLinkedin") ?? "").trim() || null,
      });
    }
  }

  revalidateCompany();
}

/**
 * Parse the level-titles box into a match override.
 *
 * One phrase per line, stored as-is — they are matched as case-insensitive regexes, so plain
 * text works and a power user can still write a pattern. An empty box clears the override
 * rather than storing an empty rule, so "no vocabulary" and "a vocabulary of nothing" cannot
 * drift apart.
 */
function parseLevelTitles(raw: string): CompanyMatchOverrides | null {
  const levelTitles = raw
    .split(/[\n,]/)
    .map((t) => t.trim())
    .filter(Boolean);
  return levelTitles.length ? { levelTitles } : null;
}

export async function updateCompany(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const sourceType = String(formData.get("sourceType") ?? "manual") as SourceType;

  const details = {
    name: String(formData.get("name") ?? "").trim(),
    careersUrl: String(formData.get("careersUrl") ?? "").trim() || null,
    websiteUrl: String(formData.get("websiteUrl") ?? "").trim() || null,
    active: formData.get("active") === "on",
    allowZeroResults: formData.get("allowZeroResults") === "on",
    matchOverrides: parseLevelTitles(String(formData.get("levelTitles") ?? "")),
  };

  // The form cannot express these configs, so it must not write one. Before this, saving the
  // page for any reason -- a level title, the careers link -- rebuilt the config from the
  // Tier 1-2 inputs, found it empty, and demoted the company to manual with its field map
  // erased: a working crawl turned into a reminder, silently.
  if (CONFIG_DRIVEN.has(sourceType)) {
    await getDb().update(companies).set(details).where(eq(companies.id, id));
    revalidateCompany(id);
    return;
  }

  // Config fields are per-source; collect only the ones that apply and drop blanks so an
  // unused key never lingers to confuse the adapter.
  const config: SourceConfig = {};
  for (const key of ["boardToken", "slug", "companyId", "tenant", "dataCenter", "site"]) {
    const value = String(formData.get(key) ?? "").trim();
    if (value) config[key] = value;
  }

  const errors = validateConfig(sourceType, config);
  // Saving an invalid config would produce a crawler that fails every run. Fall back to manual
  // so the company still appears — as something to check by hand rather than as a broken source.
  const effectiveType: SourceType = errors.length > 0 ? "manual" : sourceType;

  await getDb()
    .update(companies)
    .set({
      ...details,
      sourceType: effectiveType,
      sourceTier: effectiveType === "manual" ? 6 : sourceTierFor(effectiveType),
      sourceConfig: config,
    })
    .where(eq(companies.id, id));

  revalidateCompany(id);
}

function sourceTierFor(sourceType: SourceType): number {
  if (sourceType === "workday") return 2;
  if (["greenhouse", "lever", "ashby", "smartrecruiters"].includes(sourceType)) return 1;
  if (sourceType === "custom_json") return 3;
  if (sourceType === "jsonld") return 4;
  if (sourceType === "html") return 5;
  return 6;
}

export async function deleteCompany(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // Cascades to its jobs and contacts by foreign key.
  await getDb().delete(companies).where(eq(companies.id, id));
  revalidateCompany();
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export async function addContact(formData: FormData) {
  const companyId = String(formData.get("companyId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!companyId || !name) return;

  await getDb().insert(contacts).values({
    id: crypto.randomUUID(),
    companyId,
    name,
    phone: String(formData.get("phone") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    linkedinUrl: String(formData.get("linkedinUrl") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });

  revalidateCompany(companyId);
}

export async function updateContact(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const companyId = String(formData.get("companyId") ?? "");
  if (!id) return;

  await getDb()
    .update(contacts)
    .set({
      name: String(formData.get("name") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim() || null,
      email: String(formData.get("email") ?? "").trim() || null,
      linkedinUrl: String(formData.get("linkedinUrl") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, id));

  revalidateCompany(companyId);
}

export async function deleteContact(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const companyId = String(formData.get("companyId") ?? "");
  if (!id) return;
  await getDb().delete(contacts).where(eq(contacts.id, id));
  revalidateCompany(companyId);
}

/**
 * Record that a contact genuinely shares its phone number with someone else.
 *
 * Silences the duplicate-number warning for this contact only. A different name appearing on
 * the same number later still raises it, which is the case actually worth catching.
 */
export async function acknowledgeSharedNumber(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const companyId = String(formData.get("companyId") ?? "");
  if (!id) return;

  await getDb()
    .update(contacts)
    .set({ sharedNumberOk: true, updatedAt: new Date() })
    .where(eq(contacts.id, id));

  revalidateCompany(companyId);
}
