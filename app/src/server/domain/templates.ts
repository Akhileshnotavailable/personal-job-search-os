/**
 * Message templates.
 *
 * Variables are *detected*, not declared: a template is plain text containing {{placeholders}},
 * so rewording one never means touching a schema or a form definition (PRD §28). Anything the
 * app knows -- the role, the company, the resume link -- is filled automatically; the rest is
 * asked for once and the result is always editable before it is sent.
 *
 * Pure, so the whole substitution path is testable without a database or a browser.
 */

export const KNOWN_VARIABLES: Record<string, { label: string; hint: string }> = {
  name: { label: "Contact name", hint: "Who you are messaging" },
  company: { label: "Company", hint: "Where the role is" },
  role: { label: "Role", hint: "The job title" },
  job_link: { label: "Job link", hint: "URL of the posting" },
  resume_link: { label: "Resume link", hint: "Defaults to the link in Settings" },
  your_name: { label: "Your name", hint: "How you sign off" },
};

const VARIABLE_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Variable names used by a template, de-duplicated, in first-appearance order. */
export function extractVariables(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of body.matchAll(VARIABLE_RE)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Substitute values into a template.
 *
 * An unfilled variable is left as its literal {{placeholder}} rather than replaced with an empty
 * string. A gap you can see is a gap you fix; silently sending "Hi , I saw a role at" is the
 * failure this avoids.
 */
export function renderTemplate(
  body: string,
  values: Record<string, string | null | undefined>,
): string {
  return body.replace(VARIABLE_RE, (whole, name: string) => {
    const value = values[name];
    return value != null && value !== "" ? value : whole;
  });
}

/** Variables still unfilled after rendering — surfaced so the UI can warn before copying. */
export function missingVariables(
  body: string,
  values: Record<string, string | null | undefined>,
): string[] {
  return extractVariables(body).filter((v) => {
    const value = values[v];
    return value == null || value === "";
  });
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

/**
 * Normalise a phone number to E.164 digits for a wa.me link.
 *
 * Defaults to India's +91 when no country code is present, because that is where the contacts
 * are -- but a number that already carries one keeps it, so Navneet's US number still works.
 * Returns null rather than guessing when the result is not a plausible number: a wrong wa.me
 * link opens a chat with a stranger.
 */
export function toE164(phone: string | null | undefined, defaultCountry = "91"): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (!hasPlus) {
    // A leading 0 is a domestic trunk prefix and is never part of the international form.
    digits = digits.replace(/^0+/, "");
    if (digits.length === 10) digits = defaultCountry + digits;
  }

  // Shorter than 8 digits cannot be a mobile number; longer than 15 breaks E.164.
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export function whatsappLink(phone: string | null | undefined, message: string): string | null {
  const number = toE164(phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/**
 * A LinkedIn profile URL, normalised — never a prefilled message.
 *
 * LinkedIn has no public URL scheme that opens a conversation with body text; the
 * `/messaging/thread/new` form is session-bound and unreliable from outside the app. Pretending
 * otherwise would produce a button that silently drops the message you thought you were sending,
 * so the UI opens the profile and puts the text on the clipboard instead, and says so.
 */
export function linkedinLink(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  // Accept a bare handle or a full URL; both are things you would realistically paste.
  if (/^https?:\/\//i.test(trimmed)) {
    return /linkedin\.com/i.test(trimmed) ? trimmed : null;
  }
  const handle = trimmed.replace(/^(?:www\.)?linkedin\.com\/(?:in\/)?/i, "").replace(/^\/+/, "");
  if (!/^[A-Za-z0-9_-]{3,100}\/?$/.test(handle)) return null;
  return `https://www.linkedin.com/in/${handle.replace(/\/$/, "")}`;
}

export function mailtoLink(
  email: string | null | undefined,
  subject: string,
  body: string,
): string | null {
  if (!email) return null;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ---------------------------------------------------------------------------

/** Seeded on first load, matching the three templates in PRD §27. */
export const DEFAULT_TEMPLATES: { name: string; body: string }[] = [
  {
    name: "Casual connection",
    body:
      "Hi {{name}}, hope you're doing well! I saw a {{role}} opening at {{company}} that I'm " +
      "really interested in — {{job_link}}\n\nWould you be open to referring me? Happy to send " +
      "across anything that would help.\n\nMy resume: {{resume_link}}",
  },
  {
    name: "Senior / professional connection",
    body:
      "Hi {{name}},\n\nI hope you're well. I came across the {{role}} role at {{company}} and it " +
      "lines up closely with what I've been building — end-to-end product design across " +
      "design systems, prototyping and user research at B2B and consumer startups.\n\n" +
      "{{job_link}}\n\nIf you think I'd be a reasonable fit, I'd be grateful for a referral. " +
      "My resume is here: {{resume_link}}\n\nEither way, good to be in touch.\n\n" +
      "Best,\n{{your_name}}",
  },
  {
    name: "Email referral request",
    body:
      "Subject: Referral request — {{role}} at {{company}}\n\nHi {{name}},\n\nI'm reaching out " +
      "about the {{role}} position at {{company}}: {{job_link}}\n\nI have 3+ years of product " +
      "design experience, most recently as a Senior Product Designer at WizCommerce, owning " +
      "design end-to-end from user research through design systems to shipped UI across B2B " +
      "and consumer products. The role looks like a strong match.\n\nMy resume: " +
      "{{resume_link}}\n\nWould you be willing to refer me? Thanks either way — I appreciate " +
      "your time.\n\nBest regards,\n{{your_name}}",
  },
];
