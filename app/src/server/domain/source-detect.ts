/**
 * Identify which crawler adapter can handle a careers URL, and extract its config.
 *
 * Mirrors `crawler/adapters/registry.py::detect`. Both sides must agree, because this is what
 * the Add Company form uses to fill in `source_config`, and the crawler is what then has to
 * make sense of it. Pure regex, no network -- which is why tiers 1 and 2 resolve instantly in
 * the browser.
 *
 * Deliberately not exhaustive: if nothing matches, the company is saved as `manual` rather than
 * guessed at. A wrong adapter fails silently; an honest "manual" appears on the dashboard as
 * something to check by hand.
 */

import type { SourceConfig, SourceType } from "@/db/schema";

export type Detection = {
  sourceType: SourceType;
  sourceTier: number;
  config: SourceConfig;
  label: string;
};

type Matcher = {
  sourceType: SourceType;
  sourceTier: number;
  label: string;
  pattern: RegExp;
  build: (m: RegExpMatchArray) => SourceConfig;
};

// Order matters: a Workday URL must not be claimed by a looser pattern.
const MATCHERS: Matcher[] = [
  {
    sourceType: "workday",
    sourceTier: 2,
    label: "Workday",
    pattern:
      /([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-zA-Z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/,
    build: (m) => ({ tenant: m[1], dataCenter: m[2], site: m[3] }),
  },
  {
    sourceType: "greenhouse",
    sourceTier: 1,
    label: "Greenhouse",
    pattern: /(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([A-Za-z0-9_-]+)/,
    build: (m) => ({ boardToken: m[1] }),
  },
  {
    sourceType: "lever",
    sourceTier: 1,
    label: "Lever",
    pattern: /jobs\.lever\.co\/([A-Za-z0-9_-]+)/,
    build: (m) => ({ slug: m[1] }),
  },
  {
    sourceType: "ashby",
    sourceTier: 1,
    label: "Ashby",
    pattern: /jobs\.ashbyhq\.com\/([A-Za-z0-9_-]+)/,
    build: (m) => ({ slug: m[1] }),
  },
  {
    sourceType: "smartrecruiters",
    sourceTier: 1,
    label: "SmartRecruiters",
    pattern: /careers\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/,
    build: (m) => ({ companyId: m[1] }),
  },
];

export function detectSource(url: string): Detection | null {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return null;

  for (const matcher of MATCHERS) {
    const match = trimmed.match(matcher.pattern);
    if (match) {
      return {
        sourceType: matcher.sourceType,
        sourceTier: matcher.sourceTier,
        config: matcher.build(match),
        label: matcher.label,
      };
    }
  }
  return null;
}

/** Human-readable summary of a stored config, for the companies table. */
export function describeConfig(sourceType: SourceType, config: SourceConfig): string {
  switch (sourceType) {
    case "greenhouse":
      return config.boardToken ?? "—";
    case "lever":
    case "ashby":
      return config.slug ?? "—";
    case "smartrecruiters":
      return config.companyId ?? "—";
    case "workday":
      return config.tenant && config.dataCenter && config.site
        ? `${config.tenant}.${config.dataCenter}/${config.site}`
        : "incomplete";
    case "manual":
      return "checked by hand";
    default:
      return sourceType;
  }
}

/**
 * Sources whose config is a field map -- endpoints, paths, selectors -- kept in
 * scripts/company_sources.json. The company form has no inputs for them, so it shows the
 * adapter read-only and never rewrites the config.
 */
export const CONFIG_DRIVEN: ReadonlySet<SourceType> = new Set([
  "json_api",
  "hydration",
  "html_list",
]);

/** Errors that would make a crawl fail, checked before the company is saved. */
export function validateConfig(sourceType: SourceType, config: SourceConfig): string[] {
  const need = (key: keyof SourceConfig, hint: string) =>
    config[key] ? null : `${String(key)} is required (${hint})`;

  const checks: (string | null)[] = (() => {
    switch (sourceType) {
      case "greenhouse":
        return [need("boardToken", "the slug in boards.greenhouse.io/<token>")];
      case "lever":
        return [need("slug", "the segment in jobs.lever.co/<slug>")];
      case "ashby":
        return [need("slug", "the segment in jobs.ashbyhq.com/<slug>")];
      case "smartrecruiters":
        return [need("companyId", "the segment in careers.smartrecruiters.com/<id>")];
      case "workday":
        return [
          need("tenant", "the subdomain, e.g. nvidia"),
          need("dataCenter", "the shard, e.g. wd5 — it is not guessable"),
          need("site", "the career site slug, e.g. NVIDIAExternalCareerSite"),
        ];
      default:
        return [];
    }
  })();

  return checks.filter((c): c is string => c !== null);
}
