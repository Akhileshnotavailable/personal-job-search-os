# Progress and open work

The durable state of this project. Updated whenever something meaningful lands, so no context is
lost between sessions (PRD §73). Picking this up cold: read `CLAUDE.md` first, then this file.

**Last updated:** 2026-10-22

---

## Where things stand

Phase 0 is **deployed and running in production**: <https://job-search-os.sarthak-ahuja0007.workers.dev>

104 jobs from 14 companies, 16 relevant SDE-2 matches, and a digest email delivered to Sarthak's
inbox. Re-running the crawl creates nothing and re-running the notifier sends nothing.

**Fully autonomous.** The GitHub Actions workflow runs end to end every 12 hours: it reaches the
app through an Access service token, crawls 14 companies, ingests, and sends a digest.

Cloudflare Access is verified in both directions — browser pages 302 to the login, the crawler's
service token gets 200 on `/api/*`, and a bare bearer token gets nothing. The 34 referral contacts
are loaded and reachable only from behind Access.

| Milestone | State |
|---|---|
| M0 Foundation | done |
| M1 Companies / contacts / settings | partial — data seeded, no CRUD UI |
| M2 Ingest pipeline | done |
| M3 Crawler core + 5 adapters | done — conformance suite still missing |
| M4 Scheduling, health, drift | done — crawl.yml (6-hourly), ci.yml, deploy.yml |
| M5 Job board | partial — board, dashboard, company health, settings, notifications; no job detail page |
| M6 Notifications | done — digest delivered to the real inbox in production |
| M7 Templates | done — variable detection, auto-fill, preview, copy, WhatsApp and email |
| M8 Applications Kanban | done — five stages, drag and drop with a keyboard fallback, follow-up reminders |
| M9 Dashboard | partial — first version done |
| M10 Deferred adapters | done — 21 of 26 companies crawl automatically; the 5 remaining are documented with evidence |

### Phase 1 — Interview preparation

| Milestone | State |
|---|---|
| Schema (`prep_items`) | done — one table, `kind` discriminator, JSON `content` per discipline |
| DSA | in progress — 20 seeded starter questions replaced (2026-09-22) with a 14-pattern nested folder taxonomy (100 pattern/subpattern folders, each with a Notes page). 29 Confluent-tagged solution pages published (all of Confluent's DSA question bank except one source-doesn't-name-a-problem entry), linked from `/prep/company/confluent/dsa`. A DSA question with `content.problemSummary` set now renders through its own template (`PrepPage`'s `isDsaSolution` branch) instead of the generic editor: Problem Summary / Example / Brute Force / Optimized Solution as explicit 20px headings, each with its own `SolutionCode` panel embedded between its steps and its complexity, both a Time and a Space complexity field with an explanation of *why*. Every "compute a value" LeetCode problem is wrapped in `class Solution` with the exact official method signature (no `ostream`/`void`-print solutions — even the two file-streaming questions return via a value or a callback, never write to `cout` from inside the algorithm); "design a data structure" problems keep their real LeetCode class name (`LRUCache`, `MyQueue`, `TimeMap`, ...). Sidebar shows an E/M/H difficulty badge for this folder instead of the ask-rate score, and the DSA code panel defaults to expanded with a LeetCode/source button in the header. |
| System Design | done — 10 seeded problems with requirements / architecture / trade-offs |
| Behavioral | done — 8 seeded themes with situation / action / outcome |
| Progress tracking | done — four states, `revisit` deliberately not counted as done |
| Notion import | not started — schema shaped to absorb it (PRD §39) |
| LLD question set | done — 17 pages under System Design → LLD, each with videos and articles, no solutions yet |
| Code workspace | done — read-only VS Code-style viewer on question pages (`prep_code_files`) |
| Worked LLD publishing | done — `publish_lld_solution` MCP tool: seven fixed sections composed server-side, a structured design-choices table, Mermaid diagrams, and the code published as files into the Code panel. See `docs/lld-solution-pages.md` |
| Mermaid diagrams | done — ```mermaid fences render as diagrams in any prep page body, lazily loaded |

---

## Next up, in order

**The product is complete.** Every PRD §95 milestone is built, deployed and in use. What remains
is optional and additive:

1. **Notion import** — bring Sarthak's existing prep content into `prep_items`. The schema was
   shaped to absorb it; this is a field mapping, not a redesign.
2. **Fill the remaining LLD code workspaces** — 1 of 17 done. **All LLD code is Go.** Parking
   Lot carries a worked 12-file Go module (`model` / `pricing` / `lot` / `cmd`, with a
   `pricing.Strategy` seam and an injected clock), gofmt-clean and passing `go vet` and
   `go test -race` with 10 tests. The other 16 pages carry resources but no code. Each page has a
   Code section that takes files at a path (`model/spot.go`); the tree and the highlighting are
   derived from those paths, so pasting a file is the whole interaction.
3. **CHEQ** — the only remaining source that would need a headless browser *at runtime*. One
   company does not justify shipping Chromium into the crawl (PRD §13).

See `docs/source-catalogue.md` for every company, its technique, and the evidence behind each
decision.

---

## Blocked on Sarthak

Nothing. Deployment, credentials and access control are all complete.

| Previously blocking | Resolved |
|---|---|

---

## Fit scoring

Every job carries a **fit score (0–100)** against Sarthak's resume, computed at ingest by
`src/server/domain/fit.ts` and stored on the row so the board can sort by it in SQL.

It is a separate question from relevance. `matching.ts` is a hard gate — should this job be on
the board at all — while fit ranks the ones that already qualify. Keeping them apart means a
tighter fit model can never silently hide a job the gate accepted.

Five weighted dimensions: skills (34), level precision (22), domain overlap (20), location (14)
and freshness (10). Skills carry the most weight deliberately — level, location and recency are
all readable from metadata, so if they dominated, every correctly-levelled Bangalore job would
score alike and the ranking would say nothing about the work itself.

Two design points worth keeping:

- **Missing evidence is not a bad score.** Apple, Microsoft and Rippling publish no description
  on their list endpoints (56 of 238 relevant jobs). Scoring those against a rubric that expects
  a description would rank them last for a gap in *our* data, not a flaw in the job. Instead the
  unassessable weight is removed from the denominator and the row is flagged `fit_title_only`,
  which the card shows as "title only". Their observed range is 34–68 against 0–91 for
  fully-described jobs: ranked fairly, but honestly capped short of "excellent".
- **Every point is attributable.** The score comes with named signals ("Golang · Distributed
  systems", +29), which the job card renders as chips. A number nobody can argue with is a
  number nobody can correct.

The profile lives in `DEFAULT_FIT_PROFILE` and is shaped to be moved into `settings` like the
match rules, so retuning what counts as a strong match needs no redeploy.

Bands: excellent 80+, strong 65+, good 50+, fair 35+, weak below. Current spread across 238
relevant jobs: 11 excellent, 45 strong, 87 good, 79 fair, 15 weak.

**Known limit.** A title-only job cannot reach the top band even when it deserves to — Rippling's
"Software Engineer II" in Bangalore scores 61 because its skills are unknown, not weak. The fix
is the detail fetch the crawler plan already allows for new, pre-filtered jobs; it is not built.

---

## Working the board: read state, reminders and outreach

Discovery was only ever half the problem. These are the parts that stop a board being read.

**Read state.** A job can be marked read — seen and consciously passed over. Deliberately neither
`closed_at` (the posting is gone) nor an application stage (you acted on it). Read jobs leave the
dashboard entirely and fold into a compact "Reviewed" section on the job board, so the list gets
*shorter* as you work through it. Marking read also silences that job's reminder: nagging about a
role you already decided on is how a reminder list loses its authority.

**Reminders.** Five rules, each time-since-a-state-change so every reminder can name the date its
clock started — referral unanswered, referred but not applied (the shortest threshold: someone
spent their credibility), saved and undecided, applied and silent, and a strong match nobody
touched. The nav badge runs the real rules rather than a SQL restatement of them, because that is
how a badge and its page start disagreeing.

**Outreach from the card.** Apply and Message on every job card, plus a stage picker that moves a
job through the pipeline without leaving the page. The message modal renders a template against
the company's contacts and hands it to whichever channel exists — WhatsApp, email, or LinkedIn
(which has no URL that opens a chat with body text, so the message is copied and the profile
opened, rather than a button that silently drops it).

**Emails are kept.** `email_digests` stores the subject, body, recipient and exact send time of
every digest, handed back by the drainer on delivery. The app only ever knew what was *queued*;
rebuilding a sent email later from notification rows would diverge the first time the template
changed. The outbox also re-checks relevance at send time, since match rules are data and can
change between queueing and sending — a Canadian role queued before the location list learned
"CA Remote Ontario" was found sitting ready to send, with its own rejection printed underneath.

**Page weight.** The job board once shipped 1.8 MB. Two causes, both serialisation rather than
queries: every card was handed the full contact list and every template body as props, which a
client component serialises *per card*; and 200 cards is simply a lot of markup when one company
accounts for 163 of them. Outreach is now fetched when the modal opens, groups show their best
few and link onward, and every route has a `loading.tsx` — the remaining second is D1 across the
network, and without a Suspense boundary the browser showed the *old* page for all of it.

---

## Matching: company vocabularies and the experience band

Two things a single global rule set cannot express.

**Job ladders are not comparable across companies.** Sarthak'''s level is `SDE II` at Amazon,
`Senior Software Engineer` at Confluent, and `Software Engineer III` at Google. The global
`senior` exclusion is right for most employers and wrong for Confluent, where it dropped
25 of 29 Bangalore roles before he ever saw them.

Title exclusions are therefore split in two. `exclude` covers *discipline* — sales, QA, security,
hardware — and is never lifted. `seniorityExclude` covers *level*, and a company can lift it by
declaring its own vocabulary in `companies.match_overrides`, editable from the company page. A
level override says "this level is mine here", not "any job here": "Senior Security Engineer"
stays excluded at Confluent.

The subtle half is that **the crawler needs the vocabulary too.** Its title pre-filter drops jobs
before ingest to avoid a detail fetch per posting, so a rule only the server knew about would
never be reached. The overrides are served by `/api/crawler/bootstrap` alongside the match rules,
and both evaluators have tests pinning the same Confluent case so they cannot drift.

**Experience is a band, not a ceiling.** Sarthak is eligible for 2-4 year roles, so a posting
inside that window fits cleanly, one above it is penalised per year and hard-rejected at 7, and
one *below* it is penalised gently rather than hidden — a one-year role is a worse use of a
referral, not an ineligible one. Descriptions that state no requirement are kept: 56 of 239
relevant jobs have no description at all.

Result at Confluent: 1 relevant role became 4, and the two Bangalore roles still excluded are
excluded for a good reason (they ask for 7+ and 8+ years).

---

## Company coverage — 29 of 31 crawled automatically

Full detail, and the evidence behind every decision, in
[`source-catalogue.md`](source-catalogue.md).

**Crawled (29)**

| Tier | Adapter | Companies |
|---|---|---|
| 1 | Greenhouse | Databricks, Roku, Uber Freight, Postman, DigitalOcean |
| 1 | SmartRecruiters | ServiceNow, Swiggy |
| 1 | Ashby | Sarvam AI, Confluent |
| 1 | Lever | Zeta Suite |
| 2 | Workday | NVIDIA, Adobe, Salesforce, Target, Visa |
| 3 | `json_api` | Amazon, Microsoft, Qualcomm, Atlassian, Akamai, Keychain AI, Rippling, Confluent (IBM) |
| 4 | `hydration` | DE Shaw, CHEQ |
| 5 | `html_list` | Intuit, Moveworks, Apple, Ringg |

**Manual (2)** — Google, which disallows its job results in `robots.txt` (honoured, not worked
around, ADR 008), and Wint Wealth, which has no first-party board at all and hires through
aggregators.

**Deactivated (3)** — Dell, Samsung India and VinFast, at Sarthak's request.

The last five were solved by re-testing inherited assumptions rather than by new machinery. Four
of the five "cannot be crawled" verdicts were wrong: Qualcomm's `robots.txt` *explicitly allows*
the endpoint believed forbidden, Atlassian's 401 came from a different endpoint than the public
one, CHEQ ships its jobs in the first response despite rendering them client-side, and Akamai —
which denies everything at its own edge — syndicates every job to DirectEmployers, which welcomes
crawlers. In two cases the honest User-Agent got a 200 where a browser-spoofing one got a 403.

---

## Bugs found and fixed, and what each would have cost

Recorded because every one was invisible until specifically hunted, and the class will recur.

| Bug | Symptom | Why it mattered |
|---|---|---|
| **Workday `total` only on page 1** | Later pages report `total: 0` while still returning results | Crawl stopped at 40 of NVIDIA's 2000 jobs **and reported success**. Pure silent truncation. |
| **URL normalization stripped the query** | All 870 Databricks jobs normalized to one URL | Greenhouse puts the job id in `?gh_jid=`. Would have collapsed a whole company to one job. |
| **Second unique index on the URL** | `UNIQUE constraint failed` on 869 of 870 inserts | The URL is a *fallback* identity, never an independent constraint. ADR 005 corrected. |
| **Anchored title pattern** | `^software engineer$` matched almost nothing | Silently rejected 194 of 1334 live postings — every title with a suffix. |
| **"Remote" matched foreign remote** | `Italy, Remote`, `US, FL, Remote` | Would have surfaced dozens of unreachable roles as matches. |
| **`\bstaff\b` over-matched** | Killed "Member of Technical Staff 2" | That is the SDE-2 title at several companies. |
| **Sequential Workday pagination** | Target exceeded its 180 s budget and returned 0 | Correctly flagged `degraded` rather than silently empty — the guard working as intended. |

Each is pinned by a regression test using the real input that exposed it.

---

## Politeness and adaptivity

Deliberately conservative (`crawler/http/client.py`):

- **Adaptive per-host pacing** — starts at 350 ms, decays toward 80 ms only after five consecutive
  clean responses, multiplies by 2.5 on any 429/5xx. A fixed delay is either rude to small sites or
  needlessly slow against large ones.
- **`Retry-After` always obeyed**, up to two minutes. A 429 widens the delay immediately.
- **Per-host concurrency capped at 3**, with the delay applied *inside* the semaphore so it limits
  the actual request rate rather than merely delaying the caller.
- **Per-company budgets** — 1500 requests / 600 s — so one pathological board cannot consume a run.
- **Honest User-Agent** naming the tool and stating that it respects `robots.txt` and `Retry-After`.
- **Detail fetches only for title-gate survivors** — NVIDIA: 2000 postings, ~40 candidates, ~18
  detail requests. The single largest politeness win in the system.

---

## Verified by running it, not assumed

- Re-running a crawl creates **zero** new jobs and **zero** notifications.
- `UNIQUE (company_id, external_job_id)` rejects a duplicate at the database level.
- A company that returned jobs and now returns none is marked `suspicious`, and its jobs are **not**
  closed.
- Failed, skipped and degraded runs never mutate job presence state.
- Bootstrap and ingest both reject unauthenticated requests with 401.
- 388 TypeScript tests and 251 Python tests pass; `tsc --noEmit` clean, `ruff check crawler` clean.
- Closing a reminder hides exactly that job-and-kind pair and nothing else, checked by running the
  real `buildReminders` over the live candidate rows: the count fell by one and the closed pair
  disappeared. It returns on its own once the job moves to a stage whose clock starts later.
- A referral you have already asked for keeps reminding even after the matcher demotes the job.
  Two Google "SWE 3" roles had gone silent this way — added by hand, then made irrelevant by the
  seniority rules — and neither was reachable from the reminders page until the pipeline was
  exempted from the relevance filter.
- All 8 adapter contracts verified against live endpoints by `python -m crawler.contracts`.
- A full crawl of 14 companies completes in about two minutes with zero failures: 104 jobs
  ingested, 16 relevant, 16 notifications queued.
- The notification digest renders real matches with their explanations and was delivered to the
  real inbox from production.
- Re-running the notifier in production sends nothing; re-crawling creates nothing.
- The scheduled GitHub Actions workflow completed green end to end: reached the app through Access,
  crawled 14 companies with 0 failures, correctly created 0 new jobs and sent 0 emails on a repeat
  run. All 14 automated sources report `healthy`.

---

## Books and notes: two silent failures in prep

Both were invisible from the code and obvious from the running app.

**Every book 404'd in production.** The PDFs live under `app/public/books/` and are gitignored
on purpose -- they are paid books. So a deploy from GitHub Actions, which checks out a tree
without them, shipped an assets directory without them. The books only ever worked when a deploy
happened to run from the laptop holding the files, and the next CI deploy undid it without a
word. They now live in Google Drive and are streamed through `/api/books/<page id>`.

Drive's own `/preview` iframe would have been one line, and was rejected: it puts the file id in
the page, replaces the browser's PDF reader with Google's, and makes a third party's uptime a
page dependency -- the same class of problem as the notes below. Proxying keeps the reader, the
Range header (so a 97 MB book seeks instead of downloading whole), and Access in front of it.

The cost is real and worth writing down: Drive will not serve a private file to an anonymous
fetch, so each book is shared *anyone with the link*. Anyone who learns a file id can read it.
That is wider than a file that existed only inside this deployment. The id is therefore resolved
server-side and never rendered. Volume 2 settles the argument anyway -- at 97 MB it exceeds the
25 MiB Workers asset limit and could never have been served from `public/` at all.

**The notes pages spent most of their life rate limited.** Anonymous GitHub allows 60 API calls
an hour *per egress IP*, and a Worker has no IP of its own -- it shares Cloudflare's with
everything else running there, so the real budget is an unknowable fraction of 60 and usually
already spent. The `next: { revalidate: 3600 }` on those fetches did nothing whatsoever: this
deployment configures no incremental cache (`open-next.config.ts`), so there was nowhere to put
the response and every single render went back out to the network.

The cache is ours now, in D1 (`github_notes_cache`). Three things about it matter more than the
caching itself:

- **A stale row is served when the refresh fails.** A day-old chapter beats an apology about
  rate limiting, and the UI labels it "cached copy" rather than pretending it is current.
- **The default-branch call is gone from the hot path.** It was a second API call on every view,
  doubling the cost of the request most likely to be throttled, to re-answer a question that
  never changes. It is stored with the tree.
- **A cache failure cannot break a page.** Reads and writes both swallow their errors, so the
  window between deploying this and applying its migration costs a slower render, not a 500.

## The board, and two things that were never rendered right

**The kanban did not fit its own columns.** It was a responsive grid --
`sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7` -- which fails a seven-stage pipeline twice over.
At four columns the stages wrap onto a second row, so the board stops reading left to right in
the order work actually moves through it. And at seven columns inside a 1100px page each column
is about 135px, which is narrower than a card's own footer: the stage menu and Remove button
spilled out past the column edge.

It is now what a kanban is: fixed 272px columns in a horizontally scrolling row, snapping, with
the negative margins needed to scroll edge to edge through the page gutter. A phone gets one
column at a time by swipe, which is the interaction that surface already expected.

Drag needed one addition. With every stage on screen, a drop target was always visible; now it
may not be, so a drag near either edge auto-scrolls the board. That runs on an animation frame
rather than on `pointermove`, because at the edge of the screen there is nowhere left to move the
finger and a move-driven scroll would simply stop.

**Every rendered Markdown element carried `node="[object Object]"`.** Each override in
`components/markdown.tsx` spreads its props onto a real DOM element, and react-markdown hands
each one the mdast node it came from. React 19 does not warn about an unknown prop, it renders
it, so the attribute landed on every heading, paragraph, list item and link on the page. Dropping
it took a chapter page from 149 KB to 97 KB -- 35% of that page was an invalid attribute
repeated a few thousand times.

**Known limit.** `<main>` is capped at `max-w-[1100px]`, which suits the reading-shaped pages but
means a very wide monitor shows about four of the seven columns and scrolls for the rest. Raising
that cap is a design decision about every page, not just this one, so it has not been taken here.

## Publishing study notes from an assistant

Studying happens in a chat with an AI; the notes belonged in the prep tree and were being
retyped. There is now an MCP server (`mcp/`) that publishes them directly — body, reference
videos, difficulty, ask score, topics, filed under the right section.

**It runs locally, over stdio, and that is the whole security design.** The app is behind
Cloudflare Access, so a local server can hold the Access service token and the ingest bearer
token exactly as the crawler does. A hosted MCP server or a ChatGPT Action would instead need a
path-scoped Access bypass, turning a write endpoint into the only copy of this data into
something reachable by anyone who guesses a token — to save a copy-paste. Rejected.

The cost of that choice, stated plainly: this works with clients that launch a local process
(Claude Code, Claude Desktop) and **not** with ChatGPT in a browser.

**Four tools, not one.** `prep_tree`, `prep_search`, `prep_publish`, `prep_append`. A write-only
tool would have been half the code and would have filled the tree with near-duplicates —
"Consistent Hashing", "Consistent hashing", "Design: consistent hashing" — because a model with
no way to look has no way to know. Search is what makes publish trustworthy.

Three rules make it safe to leave unattended:

- **A duplicate is refused by default.** `on_conflict` has to be set deliberately. An assistant
  that silently overwrites is how a week of notes disappears.
- **`merge` never replaces a body that already exists.** It fills empty fields and adds
  resources, so a hand-written note survives a second pass over the same topic.
- **Pages are placed by path, not id.** A model cannot know a UUID; asking for one guarantees
  either a hallucination or everything landing at the root.

**`prep_tree` took three attempts, and the wrong ones are the instructive part.** "Pages with
children" is the obvious rule and it hides the one destination that matters — a section nobody
has filled yet, which is exactly where the first page goes. LLD was invisible. "Also every
top-level page" buries the seven real sections under 36 DSA and behavioral notes, because those
disciplines are flat. "Also anything without a prompt or content" lets HLD's question pages
through, because they keep their notes in `body`. The rule that holds is structural: a kind
whose tree has depth has real sections at its top level; a flat kind has only notes there.

Verified by running it: a page published into LLD with two YouTube links and an article came
back with both video ids extracted and the publisher named, a second publish of the same title
was refused with a message saying what to do instead, and `prep_append` added a third link while
leaving the original body untouched.

**Low-level design is not a new kind.** It is `system_design` under `parent_path: "lld"`. The
unused `concept` kind in `PREP_KINDS` is still the slot if LLD ever earns its own fields.

## A second MCP server, because ChatGPT cannot launch a local process

The local stdio server works with Claude and cannot be connected to ChatGPT at any price:
ChatGPT only talks to a remote HTTPS server, and it authenticates with OAuth rather than a
bearer token. `mcp-remote/` is what that requirement forces — a Cloudflare Worker at
`job-search-mcp.sarthak-ahuja0007.workers.dev`, OAuth-guarded, speaking MCP over Streamable HTTP.

Both servers call the same `/api/prep/*` endpoints, so there is one implementation of what a
publish means and two ways to reach it.

**The exposure is real and bounded three ways.** This Worker is reachable by anyone on the
internet and can write to the prep tree:

- **OAuth guards every tool call**, with a consent screen whose password is compared in constant
  time and which fails closed when the secret is unset.
- **The app stays entirely behind Access.** No policy was weakened. The Worker reaches the app
  through a *service binding*, which dispatches to the Worker directly rather than through the
  edge — Access is not bypassed, it is simply not in that path, and the app's own bearer check
  still applies. That is the second layer of ADR 006 earning its place.
- **It does not hold the crawler's token.** `MCP_TOKEN` is accepted on `/api/prep/*` only, so
  compromising this Worker costs study notes rather than the job board.

Preview URLs are disabled. On by default, they publish every version at its own public address,
which multiplies the doors into the prep tree and leaves superseded versions reachable.

**No Durable Object and no session state.** The protocol needs one only when the server must
remember something between calls, and each of these four tools is a single request. That keeps
it on request-scoped infrastructure and inside the free tier, alongside KV for OAuth state.

**Cloudflare error 1042 shaped the design.** The obvious implementation — fetch the app over
HTTPS — fails outright: a Worker may not make a subrequest to another Worker on the same
`workers.dev` zone. Every tool returned `error code: 1042` on the first deploy. The service
binding is the supported route and removed the need for an Access service token here entirely.

Verified by walking the whole flow as ChatGPT would: dynamic client registration, a consent page
that refuses a wrong password without redirecting, PKCE token exchange, `initialize` negotiating
2025-06-18, all four tools listed with correct read-only hints, and a real DSA page published
end to end with its pattern, complexity, ask score and a NeetCode video whose YouTube id was
extracted on the way in.

**Known limits.** Developer Mode is needed in ChatGPT (Plus and above, not free), write actions
ask for confirmation per call, and ChatGPT freezes tool metadata at approval — so changing a
tool's schema needs the connector re-reviewed before it takes effect.

## Company preparation

A third top-level discipline next to DSA and System Design: `company`. One entry in `KINDS` and
one string in `PREP_KINDS` — no migration, because `kind` was always plain text. That is the
invariant in CLAUDE.md §9 paying for itself.

Each company folder holds the same five pages, so every company reads alike and an assistant
never invents a layout: **Notes** (a dump), **Question Bank** (a table per discipline of
question, how often it is asked, when it was last seen) and **DSA / HLD / LLD** indexes that
link to the real pages in those trees.

Three of the five are *generated* rather than written. A question bank typed as prose drifts out
of date in a week, and a list of links typed by hand contains URLs that were correct when they
were typed.

**Titles in, links out.** An assistant knows a question's name; only the database knows whether
a page exists and where it sits. So the tools take titles and resolve them server-side — exact
slug first, then a contains match, scoped to the right tree so an LLD question cannot resolve to
a similarly named HLD page. "Design a rate limiter" correctly found the HLD starter question
rather than the DSA hit-counter page.

**Unresolved titles are kept, not dropped.** They render under "Not written yet" and come back
in `unlinked`. That list is the most useful output of the call — it is what to study next — and
silently omitting it would make the page read as complete when it is exactly the opposite.

**A bug this feature found first.** `GET /api/prep/pages` returned `/prep/system-design/instagram`
for a page that actually lives at `/prep/system-design/hld/questions/instagram` — the bare slug
rather than the chain of slugs. Every link to a non-top-level page would have 404'd, which is
most of them and precisely the ones a company index points at. The path builder is now shared
between search and the tree route instead of being written inline in one of them.

**One existing invariant had to change.** A test asserted every kind has at least one answer
field "since the detail page renders them". A company page is a document, not an answer with a
known shape, and giving it fields would put three empty boxes on every page. The page already
guards on `fields.some(...)`, so none is a supported shape; the test now pins that the three
*practised* disciplines keep their fields and that any kind declaring fields declares them
completely.

**The generated pages are appendable, which they were not at first.** The first cut replaced the
page on every write, so recording a company's HLD questions today and its LLD questions next
month would silently discard the first lot -- and the later session has no copy to resend. That
is the normal way this gets used, so the default was wrong.

The fix is to store the structured rows in `content` and render the Markdown from them. Parsing
the table back out of the page would have been the alternative, and is exactly as fragile as it
sounds. Keeping the rows has a second benefit: every write re-resolves every link, so a question
that was "Not written yet" becomes a link the moment its page exists.

Merging has two rules that are not obvious. The **later** date wins regardless of which call it
arrived in, because "last asked" means the most recent sighting known, not the most recently
mentioned. And the **first** spelling of a question wins, because a re-report is typically typed
more carelessly than the original -- "lru cache" for "LRU Cache" -- and letting it through would
degrade the page's titles a little every time a question was mentioned again.

Verified end to end: scaffolding Amazon created all five pages, a five-question bank linked four
and named the fifth, an HLD index linked two of three, every generated link returns 200, and
three successive single-question calls accumulated 2 → 3 → 4 with a re-report updating rather
than duplicating.

`docs/mcp-guide.md` is the document handed to an assistant so "publish this" is a sufficient
instruction.

## One publishing tool per discipline

The MCP servers had a single `prep_publish` taking a `kind`. That asked the model to get two
things right at once -- `kind`, and a `parent_path` that does not follow from it -- and low-level
design exposed it: there is no `kind: "lld"`, it is `system_design` filed under `lld`. So the
commonest mistake was also the one a description could not prevent, because the tool had already
been chosen before its description was read.

Publishing is now `publish_dsa_question`, `publish_hld_design`, `publish_lld_design`,
`publish_behavioral_story`, plus `publish_page` as an explicit escape hatch. The routing moved
out of the arguments and into the tool name, where the model is choosing anyway. **The four
discipline tools expose no `kind` and no `parent_path` at all** -- there is nothing left to get
wrong once the tool is picked -- and each schema carries only its own discipline's fields, so the
shape of the call is itself a statement about what kind of work it is.

Ambiguity is handled where the model is actually reading: the rule to *ask rather than guess*
when a session covered more than one discipline sits on every tool description, not only in the
server instructions. A page filed under the wrong discipline is worse than a question, because
the company index that should link it will never find it there.

HLD keeps one argument, `section`: a "design X" problem goes to `hld/questions`, a building block
studied on its own to `hld`. That is a distinction within one discipline rather than a routing
decision between two, which is why it stayed an argument instead of becoming a fifth tool.

No server change was needed -- the API already took `kind` and `parent_path`, and the tools now
fill them in. Verified by calling each tool with no placement argument: LLD landed in
`system-design/lld`, an HLD question in `hld/questions`, an HLD concept in `hld`, DSA and
behavioral at their roots, and every page returned 200. Both servers were checked, and the
remote one's schemas confirmed to expose neither `kind` nor `parent_path`.

## Tables rendered as a wall of text, and were one click from being destroyed

A published question bank displayed as `QuestionAskedLast seen` followed by every row run
together. The Markdown in the database was a perfectly good GFM table; the page was rendering it
in the **rich editor**, which is built on tiptap StarterKit and has no table node, so
`tiptap-markdown` parsed the table into loose text.

The display was the visible half. The dangerous half is that the editor saves `toMarkdown()` on
blur -- so clicking anywhere in that page, which is the natural thing to do while reading it,
would have written the flattened text back and destroyed the table permanently.

Two kinds of page are now rendered rather than edited:

- **Generated pages** -- a company question bank or discipline index -- carry the rows they were
  built from in `content.rows`. They were never safe to hand-edit anyway: the next publish
  re-renders from those rows and would discard the edit without saying so.
- **Any page containing a Markdown table**, detected by a header row followed by a `| --- |`
  delimiter. Not being able to hand-edit a table is a real limitation. Shredding it on blur is a
  bug, and between the two the limitation is obviously the better outcome.

Everything else keeps the editor, which was checked rather than assumed: an ordinary DSA page and
an empty company Notes page both still get it.

**Not fixed, deliberately:** a table typed or pasted into an ordinary note still cannot be edited
in place -- it will be shown read-only instead. Giving the editor real table support means adding
four tiptap extensions plus a Markdown round-trip that has to survive serialisation, and a
half-working round-trip would corrupt more than the current limitation does.

## The bank cites, the indexes link, and neither creates a second copy of a question

Three changes that belong together, because they are one distinction.

**The question bank now records where a question was found** -- a `source_url` per entry,
rendered as a fourth column labelled by publisher ("LeetCode", "Blind", else the host). It no
longer links to our own page for the question at all. The bank answers "what does this company
ask, and how do we know"; the discipline indexes answer "where is our answer". Having both link
inward duplicated the indexes and made the two drift apart the moment one was republished. An
entry with no source shows an em dash and is named in `withoutSource` on the response.

**The indexes are unchanged** and still resolve titles to real pages, which is the half of this
that was already right.

**A differently-worded duplicate is now refused.** The slug check only ever caught an identical
title, and an assistant phrases a question the way its source did -- so "Design a URL Shortener"
and "Design a URL Shortener (TinyURL-style; hashing/uniqueness/high scalability)" became two
pages, splitting the notes that should have accumulated on one. `titleIdentity` strips bracketed
asides and anything after a colon or dash, then compares what is left, across the whole
discipline rather than one section.

Deliberately exact-match-after-stripping rather than a containment rule: "Two Sum" and "Two Sum
II" are different problems, and a looser rule would refuse the second one. Both were checked, and
both still publish. The refusal names the existing page, its path, and the three ways out
(`prep_append`, `merge`, `replace`, or a title that says how it differs).

Verified on the live board, and two duplicate pages created by that testing were removed
afterwards -- exactly the mess the feature exists to prevent.

## The 28 manual companies, crawled again (2026-10-22)

Pointing the app at a new D1 database lost every source config, because configs only ever
lived in the database; 28 companies fell back to "checked by hand". All 28 were re-investigated
live and now have sources, recorded in `scripts/company_sources.json` and applied with
`scripts/apply_sources.py` — so the next database change cannot lose them. Detail and evidence:
[`source-catalogue.md`](source-catalogue.md#october-2026-the-28-that-had-fallen-back-to-manual).

`python scripts/apply_sources.py check` crawled all 28 through the production adapters with no
failures, parse errors or repeated ids. Title-gate matches at verification included Apple "UX/UI
Designer" (Bengaluru), Eightfold "Sr. UX Designer" (Bangalore), Google "UX Designer, YouTube
Creator Support" (Bengaluru), JioStar "Product Designer - Design Systems" and "Senior Product
Designer" (Bengaluru), Microsoft "Product Designer -II" (Bangalore) and Zepto "Visual Designer"
(Bangalore).

Code changes, each with regression tests:

- **`json_api` re-crawls a shuffled board.** Qualcomm and PayPal serve the same job twice across
  pages and skip others while every count looks right. A repeat within a pass now triggers
  another pass until the distinct count reaches the reported total.
- **`json_api` `recordFilter`** keeps an aggregator's records to one employer id — Instahyre's
  company filter is a fuzzy text match.
- **`json_api` unescapes titles**, since WordPress serves them entity-encoded.
- **`html_list` `singlePage`** reads exactly one page and fails if it comes back full — for
  Google, whose `robots.txt` now forbids only `?page=`.
- **The company edit form no longer erases config-driven sources.** Its adapter select had no
  option for `json_api`/`hydration`/`html_list`, so saving re-typed them as greenhouse and the
  action demoted them to manual with an empty config.

Seven companies (Flipkart, Ola, Zepto, Rapido, Zomato, Blinkit, BookMyShow) are read from
Instahyre because their own board blocks crawlers or does not exist. That is a subset of their
openings; LinkedIn alert mail is the second net.

## Known gaps

- **Seven companies are covered through Instahyre**, not their own boards (TurboHire allows only
  Googlebot, Darwinbox blocks crawlers, Eternal publishes no board, BookMyShow 403s everything).
  Roles posted only to the first-party board or LinkedIn reach the app through LinkedIn alert
  mail or not at all.
- **Applying sources needs a Cloudflare credential.** `wrangler login` (or a valid
  `CLOUDFLARE_API_TOKEN`) is required to run the generated SQL against D1.

- **No conditional requests.** `etag` / `last_content_hash` are stored and sent to ingest, but
  adapters do not yet send `If-None-Match`, so nothing short-circuits on a 304.
- **Descriptions truncated** to 8000 chars of plain text — deliberate: D1 caps a statement at 100 KB
  and raw Databricks HTML exceeds 20 KB per job.
- **Contact data is not in git.** It lives only in the local D1 and the scratchpad seed script, so a
  fresh clone has companies but no contacts until re-seeded.
