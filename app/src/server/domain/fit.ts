/**
 * Fit scoring: how well a posting matches *the candidate specifically*, on a 0-100 scale.
 *
 * This is deliberately a separate question from `matching.ts`, which answers "should this job be
 * on the board at all" -- a hard gate on level, location and exclusions. Fit answers "of the jobs
 * that qualify, which are worth a referral ask today". Keeping them apart means a tighter fit
 * model can never silently hide a job the gate accepted.
 *
 * Three properties matter more than sophistication here:
 *
 * 1. **Explainable.** Every point is attributable to a named signal, and the signals are what the
 *    UI shows. A number nobody can argue with is a number nobody can correct.
 * 2. **Honest about missing evidence.** Apple, Microsoft and Rippling publish no description on
 *    their list endpoints -- 60 of 371 jobs. Scoring those against a rubric that expects a
 *    description would rank them last for a gap in *our* data, not a flaw in the job. Instead the
 *    weights that cannot be assessed are removed from the denominator, and the result is marked
 *    `title-only` so the confidence is visible rather than implied.
 * 3. **Data, not code.** The profile lives in `settings.fit_profile`, so retuning what counts as a
 *    strong match needs no deploy -- the same rule the match rules already follow.
 */

export type FitBand = "excellent" | "strong" | "good" | "fair" | "weak";

export type FitSignal = {
  /** Short label for the UI chip. */
  label: string;
  /** Which dimension this came from. */
  dimension: FitDimension;
  /** Points earned, rounded. Negative is allowed for penalties. */
  points: number;
  /** Human-readable justification, shown on hover / in the detail view. */
  detail: string;
};

export type FitDimension = "level" | "skills" | "domain" | "location" | "freshness";

export type FitResult = {
  /** 0-100, normalised over the dimensions that could actually be assessed. */
  score: number;
  band: FitBand;
  signals: FitSignal[];
  /** True when no description was available and the score rests on the title alone. */
  titleOnly: boolean;
  /** Sum of the weights that were assessable, for debugging and tests. */
  assessedWeight: number;
};

export type SkillGroup = {
  name: string;
  /** Regex sources, matched case-insensitively against title + description. */
  patterns: string[];
  /** Points for the first hit in this group. */
  weight: number;
};

export type FitProfile = {
  level: {
    /** Titles that name the exact target band. */
    exact: string[];
    /** Titles at the right altitude but not explicitly levelled. */
    adjacent: string[];
    /** Below the target band -- still worth seeing, ranked lower. */
    below: string[];
  };
  skills: SkillGroup[];
  domains: SkillGroup[];
  weights: Record<FitDimension, number>;
  /**
   * How much of the skills/domain weight survives when only a title is available. Titles do carry
   * real signal ("Software Engineer - Distributed Systems"), just far less of it, so the weight is
   * reduced rather than removed -- removing it entirely would let a bare title outscore a rich
   * description by having fewer ways to lose points.
   */
  titleOnlyRetention: number;
  bands: { excellent: number; strong: number; good: number; fair: number };
};

/**
 * The candidate's profile, from their resume: Product Designer with 3+ years across B2B and
 * consumer startups — Senior Product Designer at WizCommerce (discount engine, CRM), founding
 * designer at SuperFam (consumer family app, design system from scratch), Product Designer at
 * Khatabook (B2B partner dashboard, tokenized design system), co-founder/designer at a D2C
 * Shopify brand. Core strengths: design systems, prototyping, and user research end-to-end.
 */
export const DEFAULT_FIT_PROFILE: FitProfile = {
  level: {
    exact: [
      "\\bproduct\\s+designer\\b",
      "\\bsenior\\s+product\\s+designer\\b",
    ],
    adjacent: [
      "\\bux\\s*\\/?\\s*ui\\s+designer\\b",
      "\\bux\\s+designer\\b",
      "\\bui\\s+designer\\b",
      "\\buser\\s+experience\\s+designer\\b",
      "\\buser\\s+interface\\s+designer\\b",
      "\\binteraction\\s+designer\\b",
      "\\bexperience\\s+designer\\b",
      "\\bvisual\\s+designer\\b",
    ],
    below: [
      "\\bjunior\\s+product\\s+designer\\b",
      "\\bassociate\\s+product\\s+designer\\b",
      "\\bdesign\\s+intern\\b",
      "\\bnew\\s+grad\\b",
      "\\bgraduate\\b",
    ],
  },

  // Ordered by how central each is to the actual work shipped. A job needs only a few of these;
  // the scoring takes the best-scoring groups rather than summing everything, so a description
  // that lists a dozen buzzwords cannot outrank one that matches the core strengths.
  skills: [
    { name: "Design systems", weight: 10, patterns: ["\\bdesign\\s+systems?\\b", "\\bdesign\\s+tokens?\\b", "\\bcomponent\\s+librar", "\\btokeniz"] },
    { name: "Figma / prototyping", weight: 9, patterns: ["\\bfigma\\b", "\\bprototyp", "\\bframer\\b", "\\bhigh[\\s-]?fidelity\\b", "\\bwireframe"] },
    { name: "User research", weight: 8, patterns: ["\\buser\\s+research\\b", "\\busability\\s+testing\\b", "\\bqualitative\\s+research\\b", "\\buser\\s+interviews?\\b", "\\bdiscovery\\b"] },
    { name: "Interaction design", weight: 7, patterns: ["\\binteraction\\s+design\\b", "\\buser\\s+flows?\\b", "\\bmicro[\\s-]?interactions?\\b"] },
    { name: "Information architecture", weight: 6, patterns: ["\\binformation\\s+architecture\\b", "\\bnavigation\\s+design\\b", "\\btaxonom"] },
    { name: "Data-informed design", weight: 5, patterns: ["\\bdata[\\s-]?informed\\b", "\\bmixpanel\\b", "\\bgoogle\\s+analytics\\b", "\\ba\\/b\\s+test", "\\bproduct\\s+analytics\\b"] },
    { name: "Accessibility", weight: 4, patterns: ["\\baccessibilit", "\\bwcag\\b", "\\bhuman\\s+interface\\s+guidelines\\b", "\\bmaterial\\s+design\\b", "\\ba11y\\b"] },
    { name: "Cross-functional collaboration", weight: 4, patterns: ["\\bcross[\\s-]?functional\\b", "\\bpartner(?:ing|s)?\\s+with\\s+(?:engineer|product|pm)", "\\bworking\\s+closely\\s+with\\s+engineer"] },
    { name: "Visual design", weight: 3, patterns: ["\\bvisual\\s+design\\b", "\\badobe\\s+(?:creative\\s+suite|photoshop|illustrator|xd)\\b", "\\bbrand\\s+identity\\b"] },
    { name: "Mobile (iOS/Android)", weight: 3, patterns: ["\\bios\\b", "\\bandroid\\b", "\\bnative\\s+app\\b", "\\bmobile\\s+app\\b"] },
  ],

  // Where the candidate has actually shipped. A posting in a domain they know is a materially
  // stronger ask for a referral than one that merely uses the same tools.
  domains: [
    { name: "B2B SaaS / merchant tools", weight: 10, patterns: ["\\bb2b\\b", "\\bmerchant\\b", "\\bpartner\\s+portal\\b", "\\bcrm\\b", "\\bsaas\\b", "\\bdashboard\\b", "\\benterprise\\b"] },
    { name: "Fintech / commerce", weight: 8, patterns: ["\\bfintech\\b", "\\bbookkeeping\\b", "\\bpayments?\\b", "\\binvoic", "\\bpricing\\b", "\\bcheckout\\b", "\\be[\\s-]?commerce\\b"] },
    { name: "Consumer mobile", weight: 7, patterns: ["\\bconsumer\\s+app\\b", "\\bfamily\\b", "\\bios\\s+and\\s+android\\b", "\\bconsumer\\s+product\\b"] },
    { name: "0-to-1 / startup", weight: 6, patterns: ["\\b0[\\s-]?to[\\s-]?1\\b", "\\bfounding\\b", "\\bearly[\\s-]?stage\\b", "\\bstartup\\b", "\\byc[\\s-]?backed\\b"] },
    { name: "D2C / retail", weight: 5, patterns: ["\\bd2c\\b", "\\bretail\\b", "\\bshopify\\b", "\\bfashion\\b"] },
  ],

  // Skills carry the most weight on purpose. Level, location and freshness are all readable
  // from the title and metadata, so if they dominated, every correctly-levelled Bangalore job
  // would score alike and the ranking would say nothing about the work itself.
  weights: { level: 22, skills: 34, domain: 20, location: 14, freshness: 10 },
  titleOnlyRetention: 0.4,
  bands: { excellent: 80, strong: 65, good: 50, fair: 35 },
};

export type FitInput = {
  title: string;
  description?: string | null;
  /** 1 Bangalore, 2 Gurgaon, 3 Remote, 4 Hyderabad, null unknown. From matching.ts. */
  locationPriority?: number | null;
  postedAt?: Date | null;
  discoveredAt?: Date | null;
};

const LOCATION_FRACTION: Record<number, number> = { 1: 1, 2: 0.8, 3: 0.6, 4: 0.45 };
const LOCATION_NAME: Record<number, string> = {
  1: "Bangalore",
  2: "Gurgaon",
  3: "Remote",
  4: "Hyderabad",
};

function anyMatch(text: string, patterns: string[]): boolean {
  return patterns.some((p) => new RegExp(p, "i").test(text));
}

/** Groups that hit, best first. */
function hitGroups(text: string, groups: SkillGroup[]): SkillGroup[] {
  return groups
    .filter((g) => anyMatch(text, g.patterns))
    .sort((a, b) => b.weight - a.weight);
}

/**
 * Take the best `n` groups rather than summing every hit.
 *
 * A 7,000-character Salesforce description mentions far more technologies than a terse one, and
 * summing would rank verbosity rather than fit. Capping at the top few asks the question that
 * actually matters: does this job centre on the things the candidate is strongest at?
 */
function topWeight(groups: SkillGroup[], n: number): number {
  return groups.slice(0, n).reduce((sum, g) => sum + g.weight, 0);
}

export function scoreFit(
  input: FitInput,
  profile: FitProfile = DEFAULT_FIT_PROFILE,
): FitResult {
  const title = (input.title ?? "").trim();
  const description = (input.description ?? "").trim();
  const titleOnly = description.length < 200;
  const haystack = titleOnly ? title : `${title}\n${description}`;

  const signals: FitSignal[] = [];
  let earned = 0;
  let available = 0;

  // --- Level -------------------------------------------------------------------------------
  // Assessed from the title alone in every case, so it is always fully available.
  {
    const w = profile.weights.level;
    available += w;
    let fraction: number;
    let detail: string;
    // Checked before `exact`: a junior/associate qualifier is a substring match against the
    // exact patterns too ("Associate Product Designer" contains "Product Designer"), so the more
    // specific signal has to win first or the qualifier is never seen.
    if (anyMatch(title, profile.level.below)) {
      fraction = 0.35;
      detail = "Reads as one level below the target band";
    } else if (anyMatch(title, profile.level.exact)) {
      fraction = 1;
      detail = "Title names the Product Designer band exactly";
    } else if (anyMatch(title, profile.level.adjacent)) {
      fraction = 0.72;
      detail = "Right altitude, but the level is not stated";
    } else {
      fraction = 0.4;
      detail = "Level could not be read from the title";
    }
    const points = w * fraction;
    earned += points;
    signals.push({
      label: fraction === 1 ? "Exact level" : fraction >= 0.7 ? "Level fits" : "Level unclear",
      dimension: "level",
      points: Math.round(points),
      detail,
    });
  }

  // --- Skills ------------------------------------------------------------------------------
  {
    const retention = titleOnly ? profile.titleOnlyRetention : 1;
    const w = profile.weights.skills * retention;
    available += w;
    const hits = hitGroups(haystack, profile.skills);
    // Four groups is the ceiling: matching Go, distributed systems, backend and Kafka is already
    // a strong signal, and the fifth adds noise rather than information.
    const best = Math.min(topWeight(hits, 4), 34);
    const fraction = best / 34;
    const points = w * fraction;
    earned += points;
    signals.push({
      label: hits.length ? hits.slice(0, 3).map((h) => h.name).join(" · ") : "No skill overlap",
      dimension: "skills",
      points: Math.round(points),
      detail: hits.length
        ? `Matches ${hits.length} of the candidate's skill areas${titleOnly ? ", from the title alone" : ""}`
        : "None of the core skills appear",
    });
  }

  // --- Domain ------------------------------------------------------------------------------
  {
    const retention = titleOnly ? profile.titleOnlyRetention : 1;
    const w = profile.weights.domain * retention;
    available += w;
    const hits = hitGroups(haystack, profile.domains);
    const best = Math.min(topWeight(hits, 2), 18);
    const fraction = best / 18;
    const points = w * fraction;
    earned += points;
    if (hits.length) {
      signals.push({
        label: hits.slice(0, 2).map((h) => h.name).join(" · "),
        dimension: "domain",
        points: Math.round(points),
        detail: `Overlaps work the candidate has shipped${titleOnly ? ", inferred from the title" : ""}`,
      });
    }
  }

  // --- Location ----------------------------------------------------------------------------
  {
    const w = profile.weights.location;
    available += w;
    const priority = input.locationPriority ?? null;
    // Unknown sits mid-scale on purpose. Several sources (Apple, Amazon) omit a per-row location
    // while the query itself is already scoped to India, so treating unknown as bad would punish
    // the source rather than the job.
    const fraction = priority ? (LOCATION_FRACTION[priority] ?? 0.5) : 0.55;
    const points = w * fraction;
    earned += points;
    signals.push({
      label: priority ? (LOCATION_NAME[priority] ?? "Location") : "Location unknown",
      dimension: "location",
      points: Math.round(points),
      detail: priority
        ? `${LOCATION_NAME[priority]} — preference rank ${priority}`
        : "The source did not give a per-role location",
    });
  }

  // --- Freshness ---------------------------------------------------------------------------
  // The entire premise of this project is reaching a posting before it is flooded, so recency is
  // a component of fit rather than a sort option.
  {
    const w = profile.weights.freshness;
    available += w;
    const reference = input.postedAt ?? input.discoveredAt ?? null;
    let fraction: number;
    let detail: string;
    if (!reference) {
      fraction = 0.5;
      detail = "No posting date available";
    } else {
      const days = Math.max(0, (Date.now() - reference.getTime()) / 86_400_000);
      if (days <= 3) [fraction, detail] = [1, "Posted in the last 3 days"];
      else if (days <= 7) [fraction, detail] = [0.8, "Posted this week"];
      else if (days <= 14) [fraction, detail] = [0.55, "Posted in the last fortnight"];
      else if (days <= 30) [fraction, detail] = [0.3, "Posted this month"];
      else [fraction, detail] = [0.1, "Over a month old — likely flooded"];
    }
    const points = w * fraction;
    earned += points;
    signals.push({
      label: fraction >= 0.8 ? "Fresh" : fraction >= 0.5 ? "Recent" : "Ageing",
      dimension: "freshness",
      points: Math.round(points),
      detail,
    });
  }

  const score = available > 0 ? Math.round((earned / available) * 100) : 0;
  return {
    score,
    band: bandFor(score, profile),
    signals: signals.sort((a, b) => b.points - a.points),
    titleOnly,
    assessedWeight: Math.round(available),
  };
}

export function bandFor(score: number, profile: FitProfile = DEFAULT_FIT_PROFILE): FitBand {
  const b = profile.bands;
  if (score >= b.excellent) return "excellent";
  if (score >= b.strong) return "strong";
  if (score >= b.good) return "good";
  if (score >= b.fair) return "fair";
  return "weak";
}

export const BAND_LABEL: Record<FitBand, string> = {
  excellent: "Excellent match",
  strong: "Strong match",
  good: "Good match",
  fair: "Fair match",
  weak: "Weak match",
};
