# Relevance matching

Which jobs count as worth Sarthak's attention. Implemented in
[`app/src/server/domain/matching.ts`](../app/src/server/domain/matching.ts), configured by
`settings.match_rules`.

## What we're looking for

| Dimension | Target |
|---|---|
| Level | Product Designer / Senior Product Designer and close equivalents (UX Designer, UI Designer, UX/UI Designer) |
| Experience | 3–5 years; roles asking 3+, 4+ or 5+ are a fit, 6+ is hard rejected |
| Locations | Bangalore, Gurgaon, Remote, Hyderabad — **in that priority order** |
| Companies | Only the target list; the crawler never looks anywhere else |

## Design

**Rules are data, not code.** The whole rule set lives in `settings.match_rules` as JSON, so
retuning what counts as a match needs no deploy, and existing jobs can be re-matched retroactively.
The engine is a pure function over `(job, rules)`.

**Deliberately biased toward false positives.** A false positive costs one glance at the job board.
A false negative means the role is gone. Wherever a rule is ambiguous — no location given, no
experience stated — the job is kept and the reason says so.

**Every decision explains itself.** `match_reason` is stored alongside the score, so the UI can show
exactly why a job was included or dropped. Filtering is never a black box.

## The pipeline

```
title  ──► hard gate: exclusions first, then include patterns
   │        excluded  -> not relevant, reason names the pattern
   ▼
location ──► hard gate when known
   │        foreign country  -> not relevant
   │        unknown          -> kept, flagged
   ▼
experience ──► gate only at the extreme, otherwise a penalty
   │        >= 7 years  -> not relevant
   │        5-6 years   -> kept with -10/year
   ▼
score >= threshold (60)  ->  relevant
```

Scoring: title 60–100, location bonus 40/30/20/10 by preference, experience penalty above 4 years.
A perfect match — "Software Engineer II" in Bangalore asking 3+ years — scores 140.

`location_priority` is stored separately (1 Bangalore … 4 Hyderabad) so the board can rank by
preference and recency independently of the score.

## The cheap pre-filter

`matchTitle()` is exported on its own because the crawler runs it **before** deciding whether a job
is worth a detail fetch. NVIDIA alone has 2,000 open roles; fetching a description for each would be
2,000 requests to find perhaps three matches. The title gate reduces that to about 20.

The rules stay a single source of truth in `settings`; the crawler only re-implements regex
evaluation, not the rule set.

## Validated against live data

The rules were tuned against **1,334 real postings** from NVIDIA, Databricks and Postman on
2026-09-05, not only against invented fixtures. That exercise found three bugs that unit tests alone
would not have:

1. **The generic pattern was anchored** as `^software engineer$`, so it silently rejected 194 real
   postings — every title with a qualifier, like "Software Engineer, Linux Graphics" or "System
   Software Engineer, Engineering Workflow Platform". Real titles nearly always carry a suffix.
2. **"Remote" matched foreign-remote roles** — "Italy, Remote", "Canada, Remote", "US, FL, Remote".
   A `location.reject` list of country markers is now checked *before* the allow list.
3. **`\bstaff\b`, meant for "Staff Engineer", also killed "Member of Technical Staff 2"**, which is
   the SDE-2 title at several companies. Now excluded except when preceded by "technical".

Every one of these is pinned by a regression test using the real title that exposed it.

A false-negative audit over the 153 in-location postings the title gate rejected found no genuine
SDE-2 backend roles among them — the rejections were sales, managers, directors, architects, and
NVIDIA's silicon/hardware roles (ASIC, PCB, DFT, verification).

**Result on that sample: 1 relevant role.** That is a real finding rather than a broken filter —
those three companies currently have almost no SDE-2 backend openings in the target locations, which
is precisely the argument for crawling all 29.

## Tuning

Edit `settings.match_rules` in the Settings UI, or directly:

```bash
cd app
npx wrangler d1 execute job-search-os --local \
  --command "SELECT json_extract(match_rules,'\$.threshold') FROM settings;"
```

Loosen by lowering `threshold`, removing an over-broad exclusion, or adding an include pattern.
Tighten by raising `threshold` or adding exclusions.

When adding a rule, add a test with the real title that motivated it. Rules tuned from imagination
rather than live postings are how the anchored-pattern bug got in.
