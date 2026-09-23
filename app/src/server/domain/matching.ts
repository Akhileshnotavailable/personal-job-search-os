/**
 * Relevance matching.
 *
 * Pure, deterministic, and explainable -- no ML, no scoring magic (PRD §12, §19). Every decision
 * produces a human-readable reason so it can be audited in the UI, because the failure that
 * actually costs Sarthak a job is a role being silently filtered out.
 *
 * The rules are DATA, stored in `settings.match_rules`, not code. Retuning what counts as a match
 * requires no deploy and lets existing jobs be re-matched retroactively.
 *
 * Bias: false positives are cheap (one glance at the job board), false negatives are unrecoverable
 * (the role is gone). Where a rule is ambiguous, this engine keeps the job and explains why.
 */

// ---------------------------------------------------------------------------
// Rule configuration
// ---------------------------------------------------------------------------

export type TitleRule = {
  /** Case-insensitive regular expression, as a string so it can live in JSON. */
  pattern: string;
  score: number;
  label: string;
};

export type LocationRule = {
  name: string;
  /** 1 = most preferred. Drives ordering on the job board. */
  priority: number;
  score: number;
  aliases: string[];
};

export type MatchRules = {
  title: {
    include: TitleRule[];
    /**
     * Disqualifiers by *discipline* — sales, QA, security, hardware. These describe work Sarthak
     * does not want at any company, so a company override never lifts them.
     */
    exclude: string[];
    /**
     * Disqualifiers by *level* — senior, staff, principal, intern. These are the ones a company
     * override can lift, because job ladders are not comparable across companies: "Senior
     * Software Engineer" is the target level at Confluent while "Software Engineer III" is the
     * equivalent at Google. Optional so an older stored rule set still loads.
     */
    seniorityExclude?: string[];
  };
  experience: {
    /**
     * The band Sarthak is actually eligible for. A posting asking for anything inside
     * [idealMinYears, idealMaxYears] fits without penalty.
     */
    idealMinYears?: number;
    /** Requiring at most this many years scores full marks. */
    idealMaxYears: number;
    /**
     * Penalty per year *below* the band. A role asking for one year is not disqualifying with
     * three on the clock -- it is under-levelled, which is a ranking question, not a gate.
     */
    underLevelPenalty?: number;
    /** Requiring at least this many years is rejected outright. */
    hardRejectYears: number;
    /** Penalty per year above idealMaxYears, up to hardRejectYears. */
    penaltyPerYear: number;
    /** A description with no parseable requirement is kept, not dropped. */
    unknownPasses: boolean;
  };
  location: {
    allow: LocationRule[];
    /**
     * Checked BEFORE `allow`. Postings that name a country Sarthak cannot work in are rejected
     * even when they also say "Remote" -- live data showed "Italy, Remote", "Canada, Remote" and
     * "US, FL, Remote" all matching a naive remote alias.
     */
    reject: string[];
    /** A job with no location string is kept, not dropped. */
    unknownPasses: boolean;
  };
  /** Minimum total score to be considered relevant. */
  threshold: number;
};

/**
 * Per-company title overrides.
 *
 * A global rule cannot express a job ladder. Confluent calls Sarthak's level "Senior Software
 * Engineer"; Google calls it "Software Engineer III"; Amazon calls it "SDE II". Encoding that
 * per company is the only honest way to compare them, and it is data on the company row rather
 * than code, so adding a company's vocabulary needs no deploy.
 */
export type CompanyMatchOverrides = {
  /**
   * Titles that mean "this is my level, here". A match lifts the seniority exclusions for this
   * company only; discipline exclusions still apply, so "Senior Security Engineer" stays out
   * even at a company whose target level is "Senior Software Engineer".
   */
  levelTitles: string[];
  /** Score awarded when a level title matches. Defaults to the strongest include score. */
  score?: number;
  /**
   * Other names this employer posts under, for sources that do not use the board's spelling.
   *
   * A LinkedIn alert says "Amazon Web Services (AWS)" where the board says "Amazon"; normalising
   * cannot bridge that, because nothing about the strings says they are one employer -- only
   * knowing the company does. So it is data, and adding one is a row edit rather than a deploy.
   */
  aliases?: string[];
};

/**
 * Target configuration: Product Designer / Senior Product Designer, 3-5 years of experience,
 * and four acceptable locations ranked Bangalore > Gurgaon > Remote > Hyderabad.
 */
export const DEFAULT_MATCH_RULES: MatchRules = {
  title: {
    include: [
      // Explicit target titles -- the strongest signal. Senior is a target level here, not an
      // exclusion, since the ask covers both Product Designer and Senior Product Designer.
      { pattern: "\\bsenior\\s+product\\s+designer\\b", score: 100, label: "Senior Product Designer" },
      { pattern: "\\bproduct\\s+designer\\b", score: 100, label: "Product Designer" },
      { pattern: "\\bsenior\\s+ux\\s*\\/?\\s*ui\\s+designer\\b", score: 95, label: "Senior UX/UI Designer" },
      { pattern: "\\bux\\s*\\/?\\s*ui\\s+designer\\b", score: 90, label: "UX/UI Designer" },
      { pattern: "\\bsenior\\s+ux\\s+designer\\b", score: 90, label: "Senior UX Designer" },
      { pattern: "\\bsenior\\s+ui\\s+designer\\b", score: 90, label: "Senior UI Designer" },
      { pattern: "\\bux\\s+designer\\b", score: 85, label: "UX Designer" },
      { pattern: "\\bui\\s+designer\\b", score: 85, label: "UI Designer" },
      { pattern: "\\buser\\s+experience\\s+designer\\b", score: 85, label: "User Experience Designer" },
      { pattern: "\\buser\\s+interface\\s+designer\\b", score: 85, label: "User Interface Designer" },
      { pattern: "\\binteraction\\s+designer\\b", score: 80, label: "Interaction Designer" },
      { pattern: "\\bexperience\\s+designer\\b", score: 75, label: "Experience Designer" },
      { pattern: "\\bservice\\s+designer\\b", score: 70, label: "Service Designer" },
      { pattern: "\\bvisual\\s+designer\\b", score: 65, label: "Visual Designer" },
      { pattern: "\\bproduct\\s+design\\b", score: 65, label: "Product Design (role area)" },
      // Unlevelled fallback. Discipline exclusions run before this, so a generic "Designer"
      // title only reaches here once graphic/game/web/etc. designers have already been dropped.
      { pattern: "\\bdesigner\\b", score: 55, label: "Designer (unlevelled)" },
    ],
    // Level exclusions. These are the ones a company override can lift, because ladders are not
    // comparable across companies -- "Design Lead" is an IC ceiling at some startups and a
    // people-management title at others. Everything in `exclude` below is about the *discipline*
    // and is never lifted.
    seniorityExclude: [
      // More senior than target (Staff and above).
      "\\bstaff\\b", "\\bprincipal\\b", "\\blead\\b",
      "\\bdistinguished\\b", "\\bfellow\\b", "\\bdirector\\b",
      "\\bmanager\\b", "\\bhead\\s+of\\b", "\\bvp\\b", "\\bvice\\s+president\\b", "\\bchief\\b",
      // More junior than target.
      "\\bintern\\b", "\\binternship\\b", "\\bapprentice\\b", "\\btrainee\\b",
      "\\bnew\\s+grad\\b", "\\bgraduate\\b", "\\bjunior\\b", "\\bjr\\.?\\b",
      "\\bentry[-\\s]?level\\b", "\\bassociate\\b",
    ],
    exclude: [
      // Adjacent but different design disciplines.
      "\\bgraphic\\s+design(er)?\\b", "\\bindustrial\\s+design(er)?\\b", "\\bfashion\\s+design(er)?\\b",
      "\\binterior\\s+design(er)?\\b", "\\bgame\\s+design(er)?\\b", "\\bset\\s+design(er)?\\b",
      "\\bweb\\s+design(er)?\\b", "\\bmotion\\s+design(er)?\\b", "\\bcostume\\s+design(er)?\\b",
      "\\bsound\\s+design(er)?\\b", "\\bprint\\s+design(er)?\\b", "\\bjewelry\\s+design(er)?\\b",
      "\\bfloral\\s+design(er)?\\b", "\\btextile\\s+design(er)?\\b", "\\bcurriculum\\s+design(er)?\\b",
      // Research is a neighbouring discipline, not this one.
      "\\bux\\s+research(er)?\\b", "\\buser\\s+research(er)?\\b", "\\buser\\s+experience\\s+research(er)?\\b",
      "\\bdesign\\s+research(er)?\\b",
      // Adjacent product/engineering roles that share vocabulary with "product" or "design".
      "\\bproduct\\s+manager\\b", "\\bproduct\\s+marketing\\b", "\\bproduct\\s+analyst\\b",
      "\\bproduct\\s+owner\\b", "\\bdesign\\s+engineer\\b", "\\bdesign\\s+technologist\\b",
      "\\bdesign\\s+ops\\b", "\\bdesign\\s+operations\\b",
      "\\bsoftware\\s+engineer\\b", "\\bdeveloper\\b",
      "\\bsales\\b", "\\brecruiter\\b", "\\bmarketing\\b", "\\bcustomer\\s+success\\b",
      "\\btechnical\\s+writer\\b", "\\bsolutions?\\s+engineer\\b",
      "\\barchitect\\b", "\\binterior\\s+architect\\b",
    ],
  },
  experience: {
    // 3-5 years of product design experience.
    idealMinYears: 3,
    idealMaxYears: 5,
    underLevelPenalty: 8,
    hardRejectYears: 8,
    penaltyPerYear: 10,
    unknownPasses: true,
  },
  location: {
    allow: [
      { name: "Bangalore", priority: 1, score: 40, aliases: ["bangalore", "bengaluru", "blr"] },
      { name: "Gurgaon", priority: 2, score: 30, aliases: ["gurgaon", "gurugram", "delhi ncr", "ncr", "new delhi", "noida"] },
      // "virtual" is how DirectEmployers-syndicated boards write remote ("Virtual, IND").
      // It is safe only because reject runs before allow: "Virtual, POL, Poland" is rejected
      // on "poland" before it can match here.
      { name: "Remote", priority: 3, score: 20, aliases: ["remote", "work from home", "wfh", "anywhere", "distributed", "virtual"] },
      { name: "Hyderabad", priority: 4, score: 10, aliases: ["hyderabad", "hyd", "telangana"] },
    ],
    reject: [
      "\\bus\\b", "\\bu\\.s\\.", "united states", "\\busa\\b", "canada", "\\buk\\b",
      // Regions, not only countries. Confluent posts "CA Remote Ontario", which names no
      // country at all, so a country-only list accepted it as plain "Remote" — the same
      // failure as the original "Italy, Remote", one level down.
      "ontario", "toronto", "vancouver", "british columbia", "quebec", "montreal",
      "alberta", "calgary", "ottawa",
      "united kingdom", "ireland", "germany", "france", "italy", "spain", "portugal",
      "netherlands", "belgium", "austria", "switzerland", "sweden", "norway", "denmark",
      "finland", "poland", "czech", "hungary", "romania", "ukraine", "russia", "turkey",
      "israel", "china", "taiwan", "japan", "korea", "singapore", "malaysia", "indonesia",
      "thailand", "vietnam", "philippines", "australia", "new zealand", "brazil", "mexico",
      "argentina", "chile", "colombia", "peru", "egypt", "south africa", "armenia",
      "hong kong", "\\buae\\b", "dubai", "saudi", "\\bemea\\b", "\\blatam\\b", "\\bapac\\b",
    ],
    unknownPasses: true,
  },
  threshold: 60,
};

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type MatchResult = {
  isRelevant: boolean;
  score: number;
  /** Human-readable explanation, shown in the UI so filtering is never a black box. */
  reason: string;
  /** Best matching location's priority, for ranking. Lower is better; null when unknown. */
  locationPriority: number | null;
  matchedTitleLabel: string | null;
  requiredYears: number | null;
};

export type MatchInput = {
  title: string;
  location?: string | null;
  description?: string | null;
};

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Cheap, title-only classification. Exported separately because the crawler runs exactly this
 * as a pre-filter before deciding whether a per-job detail fetch is worth it -- NVIDIA alone has
 * 2000 open roles, and fetching a description for each would be 2000 requests to find perhaps
 * three matches. See docs/crawlers.md.
 */
export function matchTitle(
  title: string,
  rules: MatchRules = DEFAULT_MATCH_RULES,
  overrides?: CompanyMatchOverrides | null,
): { passed: boolean; score: number; label: string | null; excludedBy: string | null } {
  const t = normalizeTitle(title);

  // Discipline exclusions run first and are never lifted. A company override says "this level
  // is mine here", not "I will take any job here".
  for (const pattern of rules.title.exclude) {
    if (safeTest(pattern, t)) {
      return { passed: false, score: 0, label: null, excludedBy: pattern };
    }
  }

  const levelTitle = (overrides?.levelTitles ?? []).find((p) => safeTest(p, t));

  // Seniority exclusions apply unless this company has declared the title to be its target
  // level. Without the override, "Senior Software Engineer" is correctly out; with it, it is
  // the Confluent equivalent of SDE-2 and belongs on the board.
  if (!levelTitle) {
    for (const pattern of rules.title.seniorityExclude ?? []) {
      if (safeTest(pattern, t)) {
        return { passed: false, score: 0, label: null, excludedBy: pattern };
      }
    }
  }

  let best: TitleRule | null = null;
  for (const rule of rules.title.include) {
    if (safeTest(rule.pattern, t)) {
      if (!best || rule.score > best.score) best = rule;
    }
  }

  if (levelTitle) {
    const score = overrides?.score ?? 100;
    // The override wins only when it scores higher, so a title that also matches a normal
    // include keeps whichever label describes it best.
    if (!best || score > best.score) {
      return {
        passed: true,
        score,
        label: `Company level title: ${levelTitle}`,
        excludedBy: null,
      };
    }
  }

  return best
    ? { passed: true, score: best.score, label: best.label, excludedBy: null }
    : { passed: false, score: 0, label: null, excludedBy: null };
}

/** A malformed pattern must never take down matching for every job. */
function safeTest(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern, "i").test(text);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Experience
// ---------------------------------------------------------------------------

const YEARS_PATTERNS: RegExp[] = [
  // "3+ years" -- the explicit plus makes this unambiguous without needing nearby context.
  /\b(\d{1,2})\s*\+\s*years?/gi,
  // "minimum of 8 years", "at least 5 years"
  /(?:minimum|at\s+least|min\.?)\s+(?:of\s+)?(\d{1,2})\s*\+?\s*years?/gi,
  // "2-4 years" -- take the lower bound
  /\b(\d{1,2})\s*(?:to|-|–)\s*\d{1,2}\s*\+?\s*years?/gi,
  // "6 years of relevant experience" -- allow a few words before "experience"
  /\b(\d{1,2})\s*years?\s+(?:of\s+)?(?:\w+\s+){0,3}experience/gi,
  // "Experience: 6 years"
  /experience\s*:\s*(\d{1,2})\s*\+?\s*years?/gi,
];

/**
 * Extract the minimum years of experience a description asks for.
 *
 * Descriptions routinely mention several figures ("3+ years with Go, 6+ years overall"), so this
 * takes the SMALLEST match. That is deliberately lenient: over-reading the requirement would
 * silently discard reachable roles, and a false positive costs a glance while a false negative
 * costs the opportunity.
 */
export function parseRequiredYears(description: string | null | undefined): number | null {
  if (!description) return null;
  // Strip tags so HTML descriptions parse the same as plain text.
  const text = description.replace(/<[^>]+>/g, " ").replace(/&nbsp;?/gi, " ");

  const found: number[] = [];
  for (const re of YEARS_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0 && n <= 20) found.push(n);
    }
  }
  return found.length ? Math.min(...found) : null;
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

export function matchLocation(
  location: string | null | undefined,
  rules: MatchRules = DEFAULT_MATCH_RULES,
): { matched: LocationRule | null; unknown: boolean } {
  if (!location || !location.trim()) return { matched: null, unknown: true };
  const l = location.toLowerCase();

  // A named foreign country disqualifies the posting even when it also says "Remote".
  // "India" is never in the reject list, so "India, Remote" and "Bengaluru, India" survive.
  for (const pattern of rules.location.reject) {
    if (new RegExp(pattern, "i").test(l)) return { matched: null, unknown: false };
  }

  let best: LocationRule | null = null;
  for (const rule of rules.location.allow) {
    if (rule.aliases.some((a) => l.includes(a))) {
      if (!best || rule.priority < best.priority) best = rule;
    }
  }
  return { matched: best, unknown: false };
}

// ---------------------------------------------------------------------------
// Full match
// ---------------------------------------------------------------------------

export function matchJob(
  job: MatchInput,
  rules: MatchRules = DEFAULT_MATCH_RULES,
  overrides?: CompanyMatchOverrides | null,
): MatchResult {
  const reasons: string[] = [];

  // 1. Title -- a hard gate, softened only by this company's own level vocabulary.
  const title = matchTitle(job.title, rules, overrides);
  if (!title.passed) {
    const why = title.excludedBy
      ? `title excluded by /${title.excludedBy}/`
      : "title matched no target role pattern";
    return {
      isRelevant: false,
      score: 0,
      reason: why,
      locationPriority: null,
      matchedTitleLabel: null,
      requiredYears: null,
    };
  }
  reasons.push(`${title.label} (+${title.score})`);
  let score = title.score;

  // 2. Location -- a hard gate when known.
  const loc = matchLocation(job.location, rules);
  let locationPriority: number | null = null;
  if (loc.matched) {
    score += loc.matched.score;
    locationPriority = loc.matched.priority;
    reasons.push(`${loc.matched.name} (+${loc.matched.score})`);
  } else if (loc.unknown) {
    if (!rules.location.unknownPasses) {
      return {
        isRelevant: false, score: 0, reason: "location unknown and unknownPasses is false",
        locationPriority: null, matchedTitleLabel: title.label, requiredYears: null,
      };
    }
    reasons.push("location unknown (kept)");
  } else {
    return {
      isRelevant: false,
      score: 0,
      reason: `location "${job.location}" is not in the allowed list`,
      locationPriority: null,
      matchedTitleLabel: title.label,
      requiredYears: null,
    };
  }

  // 3. Experience -- a gate only at the extreme; otherwise a penalty.
  const years = parseRequiredYears(job.description);
  if (years !== null) {
    if (years >= rules.experience.hardRejectYears) {
      return {
        isRelevant: false,
        score: 0,
        reason: `requires ${years}+ years, at or above the ${rules.experience.hardRejectYears}-year reject threshold`,
        locationPriority,
        matchedTitleLabel: title.label,
        requiredYears: years,
      };
    }
    const minYears = rules.experience.idealMinYears ?? 0;
    if (years > rules.experience.idealMaxYears) {
      const penalty = (years - rules.experience.idealMaxYears) * rules.experience.penaltyPerYear;
      score -= penalty;
      reasons.push(`requires ${years}+ yrs, above target (-${penalty})`);
    } else if (years < minYears) {
      // Under-levelled, not ineligible: he can apply to a one-year role, it is just a worse use
      // of a referral than one asking for three. A penalty ranks it down; a gate would hide it.
      const penalty = (minYears - years) * (rules.experience.underLevelPenalty ?? 0);
      score -= penalty;
      reasons.push(
        penalty > 0
          ? `requires only ${years}+ yrs, below the ${minYears}-${rules.experience.idealMaxYears} band (-${penalty})`
          : `requires ${years}+ yrs`,
      );
    } else {
      reasons.push(
        `requires ${years}+ yrs (fits ${minYears}-${rules.experience.idealMaxYears})`,
      );
    }
  } else if (rules.experience.unknownPasses) {
    reasons.push("experience not stated (kept)");
  }

  const isRelevant = score >= rules.threshold;
  if (!isRelevant) reasons.push(`below threshold ${rules.threshold}`);

  return {
    isRelevant,
    score,
    reason: reasons.join(", "),
    locationPriority,
    matchedTitleLabel: title.label,
    requiredYears: years,
  };
}
