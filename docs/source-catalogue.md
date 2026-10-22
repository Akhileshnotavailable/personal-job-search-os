# Source catalogue

Every target company, the technique used to crawl it, and — where it is not crawled — the
specific reason, verified rather than assumed.

The organising idea: **the stubborn companies were never individual problems, they were a
handful of patterns.** Building for the pattern rather than the company is what turned all but
one of them into configuration rather than code.

**Every active company now crawls automatically** (2026-10-22). Source configs are kept in
[`scripts/company_sources.json`](../scripts/company_sources.json) and applied to D1 by
`scripts/apply_sources.py` — see [October 2026](#october-2026-the-28-that-had-fallen-back-to-manual)
for why they now live in the repo and not only in the database.

Seven of them are read from **Instahyre** because their own board refuses automated access or
does not exist. That is a narrower view than the company's own board, and it is said plainly
here rather than counted as full coverage:

| Company | First-party board | Why it is not read directly |
|---|---|---|
| Flipkart, Ola | TurboHire | `robots.txt` allows Googlebot only |
| Zepto, Rapido | Darwinbox | API answers our crawler with Cloudflare "you have been blocked"; `zepto.com` is an AWS WAF challenge |
| Zomato, Blinkit | none | Eternal publishes no board — its careers page says to find someone to vouch for you, or email hr@eternal.com |
| BookMyShow | unknown | `in.bookmyshow.com` returns 403 to everything, `robots.txt` included |

KhataBook and OYO are on Instahyre too, with no openings today; their own careers pages are dead
(KhataBook's times out in a browser, OYO's redirects to the homepage).

LinkedIn job-alert mail (`crawler/linkedin/`) remains the second net for all of these: an alert
for "Product Designer" at Flipkart or Zepto catches a role that was never posted to Instahyre.

Three former members of this list were promoted once they were investigated properly rather than
statically scanned — a static regex over the careers HTML found nothing for any of them, and a
browser watching what the page actually loads found all three:

| Company | Found | Now |
|---|---|---|
| **BrowserStack** | `browserstack.wd3.myworkdayjobs.com/External` in a linked page | Workday, 32 jobs |
| **Cohesity** | A bespoke JSON API whose own `jobUrl` field pointed at Workday | Workday, 164 jobs |
| **PhonePe** | SmartRecruiters under `PHONEPELIMITED`, not the guessable `phonepe` | SmartRecruiters, 53 jobs, all India |
| **Wint Wealth** | A public `anon_employer` API on Instahyre — no login, despite the site itself gating pages | `json_api`, board currently empty |

**Myntra** looked the most hopeless of all — the board is a Flutter app painting to a WebGL
canvas, so there is genuinely no DOM to scrape. But a canvas still has to get its data from
somewhere: watching the page revealed `io.spire2grow.com/ies/v1/p/requisition/_search`, and the
only header it actually requires is `workspaceid: MYNTRA-93as3`. The browser also sends a
timestamp-derived `workflowid`, which turned out to be unnecessary — worth testing rather than
assuming, since a session token would have made this a much harder source. 60 jobs.

**Truva** publishes a Zoho Recruit *public* API (`/recruit/v2/public/Job_Openings`) whose records
carry a ready-made `$url`. Its own `/careers` page is a 404; the board is linked from `/about`.

**Flipkart** has no reachable first-party board either, so it is crawled from Instahyre like Wint
Wealth — and unlike Wint Wealth it is actively hiring: 55 roles, three of them matches including
a Bangalore "Software Engineer".

**Wint Wealth** deserves its own note. It has no first-party board at all, so it is crawled from
Instahyre, where its profile is served by a public endpoint that needs no account even though
Instahyre's own HTML pages return 403 to a plain client. The field map was verified against an
employer that *does* have openings rather than guessed, because Wint Wealth's board is empty
today — and it is the one company on the list with `allow_zero_results`, since an empty board is
its normal state and the zero-result guard would otherwise call that suspicious every run.

The lesson is the one already recorded below for Qualcomm and Akamai, in a third form: **a
negative result from a static scan is not evidence of absence.** Cohesity's own API answered the
question by naming its Workday tenant in a field, and PhonePe was one wrong token away the whole
time.

---

## October 2026: the 28 that had fallen back to manual

When the app was pointed at a new D1 database (commit `9492aa1`), source configs did not come
with it — they had only ever lived in the old database. Twenty-eight companies showed up as
"checked by hand", including a dozen that had crawled for weeks. All 28 were re-investigated
from scratch rather than restored from this document, and that was the right call: several of
the documented conclusions had gone stale.

| Company | Source now | Jobs at verification |
|---|---|---|
| Akamai | DirectEmployers `jobsyn` API, India | 19 |
| Apple | `html_list`, India search | 189 |
| DigitalOcean | Greenhouse `digitalocean98` | 183 |
| Eightfold | Its own pcsx API at `app.eightfold.ai` | 48 |
| Google | `html_list`, one page only (below) | 2 |
| Headout | Ashby `headoutinc` | 25 |
| Hotstar | Workday `jiostar.wd102/JioStar` | 247 |
| Housing | WordPress REST, `wp/v2/job-listings` | 47 |
| Intuit | `html_list`, Radancy envelope | 595 |
| Microsoft | pcsx API, India | 238 |
| Moveworks | `html_list` (also inside ServiceNow's board) | 74 |
| Myntra | spire2grow API | 44 |
| PayPal | pcsx API at `paypal.eightfold.ai`, whole board | 319 |
| PhonePe | SmartRecruiters `PHONEPELIMITED` | 120 |
| Postman | Workday `postman.wd108/careers` | 25 |
| Qualcomm | pcsx API, India | 559 |
| Rippling | Algolia index | 641 |
| Uber | Oracle Recruiting Cloud requisition API | 715 |
| Yellow.ai | Zoho Recruit public `Job_Openings` | 1 |
| Flipkart, Ola, Zepto, Rapido, Zomato, Blinkit, BookMyShow, KhataBook, OYO | Instahyre, filtered to the employer id | 42, 1, 27, 6, 5, 1, 3, 0, 0 |

What changed, and what each taught:

**Google's `robots.txt` changed.** The full ban on `/about/careers/applications/jobs/results`
now sits in a group of its own for Yandex. The `User-agent: *` group disallows only the
paginated results — `?page=` — so the first page of any search, and every job page, is
permitted. Google is crawled with `singlePage`: one request for UX and Marketing roles matching
"designer" in India, never a second page. The query is narrow (2 results against a page of 20),
and if it ever fills the page the crawl fails loudly instead of returning twenty and calling it
complete. When there are no openings, the page still renders its "Sort by" header, which is what
tells an empty result apart from a redesigned page.

**Python's `robotparser` is not RFC 9309.** Eightfold, PayPal, Microsoft and Qualcomm share one
`robots.txt`: `Disallow: /` followed by `Allow: /careers` and `Allow: /api/pcsx`. The standard is
longest-match, so the Allow wins for those paths. `urllib.robotparser` applies the *first* rule
that matches, and reports everything disallowed. That is how Eightfold came to be documented as
uncrawlable while three other boards with the identical file were crawled.

**Unstable sort order skips jobs while every count looks right.** Qualcomm's search sorts by a
"distance" score that ties across most of the board, and the tie order changes between requests.
One pass returned 559 rows covering 550 jobs — nine served twice, nine never served. PayPal does
the same. `json_api` now treats a job repeated within one pass as proof the order moved, and
re-crawls until the distinct count reaches the reported total (it takes one extra pass). A pass
that is short *without* repeats is left alone; that is an endpoint stopping early, and
re-crawling cannot fix it.

**An aggregator's company filter is a text match.** Instahyre's `companies=Housing` returns
"House of Models" and "Vastu Housing Finance". `recordFilter` keeps only records whose
`employer.id` is the configured one. Each filtered count was cross-checked against the
employer's own `jobs_count`, and they agree.

**A name match is not an identity match.** General Catalyst's portfolio board lists a "Zepto" —
the Australian payments company, linking to `zepto.bamboohr.com`. It would have filed Sydney
roles under Zepto India.

**Boards move.** Postman left Greenhouse for Workday; its Greenhouse token now returns nothing.
Hotstar hires as JioStar. Flipkart's careers site links to TurboHire, not Instahyre.

**The edit form was erasing config-driven sources.** The company page's adapter `<select>` had
no option for `json_api`, `hydration` or `html_list`, so the browser selected the first one,
`greenhouse`. Saving the page for any reason — a level title, the careers link — submitted
greenhouse with no board token, failed validation, and wrote the company back as manual with an
empty config. Those adapters are now shown read-only and their config is never rewritten by
the form.

Still not crawled directly, by choice: TurboHire (Googlebot-only `robots.txt`), Darwinbox
(Cloudflare block), `careers.pypl.com` (Cloudflare challenge — the Eightfold board behind it is
read instead), `jobs.uber.com` pages (intermittent challenge — the Oracle API behind it is read
instead), and `zepto.com` (AWS WAF).

---

## What the last five taught

Four companies were previously documented here as "refuses automated access" and one as "renders
only in a browser". **Four of those five conclusions were wrong**, and each was wrong in an
instructive way.

| Company | Was believed | Actually true |
|---|---|---|
| Qualcomm | Eightfold API returns 403 to every client | `robots.txt` **explicitly allows `/api/pcsx`**, which returns 200 — to the *honest* User-Agent |
| Atlassian | Careers endpoint returns 401 without a token | The 401 was a different endpoint; `/endpoint/careers/listings` is public and unauthenticated |
| CHEQ | Zoho Recruit builds the listing in the browser | The listing is built in the browser, but the *data* arrives in the first response |
| Akamai | Edge returns `Access Denied`, full stop | True of `akamai.com` — but Akamai syndicates every job to DirectEmployers, which welcomes crawlers |
| Google | Bot-protected by design | Correct, and `robots.txt` says so explicitly. Still excluded. |

Three lessons worth keeping:

**The honest User-Agent outperformed the browser-spoofing one.** Qualcomm's endpoint returns 200
to `job-search-os/0.1 (personal job-search tool; respects robots.txt)` and **403 to a Chrome UA
string**. Politeness was not a constraint to work around; it was the thing that worked. The same
holds for the `x-origin` header Akamai's board expects — sending what an API asks for is not
evasion.

**"Renders in a browser" is a claim about the DOM, not about the response.** CHEQ's listing really
is assembled by JavaScript, which is why the rendered page was the only place jobs appeared to
exist. But the 1.7 MB first response already contained all ten jobs, entity-encoded inside
`<input id="jobs" value="...">`. The earlier check searched for job ids in URL form and found
none; the ids were there in a different shape. **A negative result is only as good as the shape
you searched for.**

**A blocked front door is not a blocked building.** `akamai.com` denies everything, including its
own `robots.txt`. But Akamai publishes to **DirectEmployers**, whose `robots.txt` reads `Allow: /`.
Asking "who else does this company deliberately publish to?" turned the hardest refusal into an
ordinary tier-3 config.

The headless browser was used **only as a discovery tool, offline** — to watch what each stuck
page asked for. It is not a runtime dependency, no adapter launches one, and CI ships no Chromium.
Every endpoint it revealed is now called with plain HTTP.

---

## The five patterns

| Pattern | Adapter | Tier | What it is | Adding a company |
|---|---|---|---|---|
| **Public ATS feed** | `greenhouse` `lever` `ashby` `smartrecruiters` | 1 | Endpoints built for embedding job widgets. Documented, stable, unauthenticated. | config |
| **Workday CXS** | `workday` | 2 | Undocumented but ubiquitous; one adapter serves every tenant. | config |
| **Bespoke JSON search** | `json_api` | 3 | The company's own search endpoint, or a board it syndicates to. | config |
| **Embedded hydration** | `hydration` | 4 | The page ships its data in the first response — `__NEXT_DATA__`, a `window.__X__` assignment, or an HTML attribute. | config |
| **Rendered HTML list** | `html_list` | 5 | Markup, sometimes wrapped in a JSON envelope. Least stable; last resort before manual. | config |
| **Manual** | — | 6 | The source asks not to be crawled. | config |

All of them are driven by a small field-mapping language
(`crawler/normalization/fieldmap.py`), so a new company on any pattern is a row in `companies`,
not a Python file.

---

## Crawled automatically (29)

### Tier 1 — public ATS feed (10)

| Company | ATS | Identifier |
|---|---|---|
| Databricks | Greenhouse | `databricks` |
| Roku | Greenhouse | `roku` |
| Uber Freight | Greenhouse | `uberfreight` |
| Postman | Greenhouse | `postman` |
| DigitalOcean | Greenhouse | `digitalocean98` |
| ServiceNow | SmartRecruiters | `servicenow` |
| Swiggy | SmartRecruiters | `swiggy` |
| Sarvam AI | Ashby | `sarvam` |
| Confluent | Ashby | `confluent` |
| Zeta Suite | Lever | `zeta` |

### Tier 2 — Workday CXS (5)

| Company | Tenant | Shard | Site |
|---|---|---|---|
| NVIDIA | `nvidia` | `wd5` | `NVIDIAExternalCareerSite` |
| Target | `target` | `wd5` | `targetcareers` |
| Salesforce | `salesforce` | `wd12` | `External_Career_Site` |
| Visa | `visa` | `wd5` | `Visa` |
| Adobe | `adobe` | `wd5` | `external_experienced` |

### Tier 3 — bespoke JSON search (8)

**Amazon** — `amazon.jobs/en/search.json`, scoped to India at the query level. The board carries
over 10,000 roles globally while matching only ever accepts four Indian locations, so the crawl
filters server-side: better for us, far less load for them. First crawl found **2,391 India roles,
160 of them SDE-2 matches** — the single largest source of relevant results in the product.

**Microsoft** — `apply.careers.microsoft.com/api/pcsx/search`, scoped to India (226 roles). The
widely-cited `gcsservices` endpoint is dead: it now fails TLS with a hostname mismatch. This is
its live replacement, and it **silently caps its page size at 10** however large a `num` you send,
while correctly reporting `count=226`.

**Qualcomm** — `careers.qualcomm.com/api/pcsx/search`, scoped to India (**579 roles**).

Its `robots.txt` is unusually explicit: `Disallow: /` followed by `Allow: /careers`,
`Allow: /api/apply` and **`Allow: /api/pcsx`** — the endpoint is *published as crawlable*. It
returns 200 to our honest User-Agent and 403 to a browser-spoofing one, so the earlier "403 to
every client tried" conclusion had been reached by testing only the disguised client. It caps page
size at 10 like Microsoft, so 579 jobs is 58 pages; `maxPages` is 90, with room to grow.

**Atlassian** — `www.atlassian.com/endpoint/careers/listings`: the whole board in one response
(253 roles, 32 of them in India). No auth, no pagination, stable numeric `id`. The 401 recorded
earlier came from a *different* endpoint; this is the one the careers page itself calls.

**Akamai** — `prod-search-api.jobsyn.org/api/v1/solr/search`, filtered to India (16 roles).

`akamai.com` returns `Access Denied` to everything, including its own `robots.txt`, and its Oracle
backends time out. But Akamai syndicates its jobs to DirectEmployers (`akamai.dejobs.org`), whose
`robots.txt` is `Allow: /` with only feeds disallowed. That board's API expects an
`x-origin: akamai.dejobs.org` header — the value the board sends for itself, not a disguise — and
1-based page numbers, which is why `json_api` grew a `startPage`. Its job URLs embed a slugified
city, which is why the field-mapping language grew `{location_exact|slug}`.

**Rippling** — an Algolia index (`careers_en-US_production`), 679 roles, 208 of them in India.

The careers page renders client-side and `rippling.com/robots.txt` says `Disallow: /api`, so the
company's own endpoint is off-limits. Its search is not there, though: it is a hosted Algolia
index on `algolia.net`, queried with the public search-only key every visitor's browser uses. The
board paginates in the POST **body** rather than the URL, which is why `json_api` learned to look
for pagination markers in both. Note `objectID`, not `jobId`, is the stable identity -- a role
open in three cities appears three times, sharing one `jobId`.

**Confluent (IBM)** — the same DirectEmployers API as Akamai, scoped to
`q=confluent&location=India` (29 roles, all Bangalore).

Confluent's own Ashby board still works and is still crawled; it simply carries almost nothing in
India — 22 roles, one of them Indian and that one Staff level. The roles are at IBM, tagged
Confluent in the title.

Getting them is a second lesson in *which door you knock on*. `careers.ibm.com` sits behind an
**AWS WAF challenge**: it answers HTTP 202 with an empty body and expects a browser to run
`challenge.js` and post to `mp_verify`. Solving that is exactly the evasion ADR 008 forbids, so
that door stays shut. But IBM syndicates to DirectEmployers like Akamai does, and `ibm.dejobs.org`
serves the same `robots.txt`-permitted `jobsyn.org` API with no challenge at all. One header value
changes (`x-origin: ibm.dejobs.org`) and the adapter is the one that already existed.

It is a separate company row rather than a second source on Confluent, because a company has one
source config; naming it plainly is better than hiding a second board inside the first.

**Keychain AI** — `jobs.lsvp.com/api-boards/search-jobs`, a Lightspeed portfolio board. Requires a
per-session CSRF token issued on the page, so the adapter primes: fetch the page, lift the token,
send it as a header with the session cookie intact. Seven roles, all in Gurgaon.

### Tier 4 — embedded hydration (2)

**DE Shaw** — all 85 openings sit in `props.pageProps.regularJobs` inside `__NEXT_DATA__`. The
canonical job URL was confirmed empirically rather than guessed: every candidate path returns 200
because the site is a catch-all SPA, but only `/careers/<slug>` returns `jobData` in its hydration.

**CHEQ** — all 10 openings sit in `<input id="jobs" value="...">` as entity-encoded JSON.

Zoho Recruit assembles the visible listing client-side, which is why watching the DOM suggested a
runtime browser was unavoidable. It is not: the data is in the first response, and the adapter
reads it over plain HTTP. This is the third shape of "the page ships its own data", alongside
`__NEXT_DATA__` and `window.__X__`.

### Tier 5 — rendered HTML list (4)

**Intuit** — Radancy/TalentBrew, which returns a JSON envelope whose `results` key is a blob of
HTML. Items are `li[data-intuit-jobid]`, carrying a stable id, title, location and href.

**Moveworks** — the careers page ships its jobs in static HTML after all, in
`div.cmp-job-listings__job`. Earlier searches missed them because the board sits below a
JavaScript filter widget; the markup was always there. Its only stable id lives inside the apply
link, so the field map pulls it out with a regex.

**It serves an empty board intermittently.** The same URL returns 82 jobs on one request and a
listing component containing nothing on the next -- reproduced repeatedly, from two countries,
minutes apart. Nothing about the markup differs otherwise, so this is almost certainly cache or
edge variance rather than anything the crawler does.

That produced a false `schema drift` failure, because zero matches was the only signal the
adapter had. `listContainerSelector` now names the element proving the listing component
rendered: zero items inside a container that is still there is an empty response, while a
container that has vanished is a rebuilt page and still raises loudly.

Reporting zero is where it must stop, though. `allow_zero_results` stays **off**, so an empty
response becomes `suspicious`, and a run that is not `success` never touches job presence -- the
82 real jobs survive however many empty responses arrive in a row. Setting that flag on looks
harmless and is not: it skips the zero check, the run is graded `degraded` on volume drift
instead, and a degraded run *does* run presence tracking. Two empty responses took these jobs to
`missing_run_count` 2 of 3 before it was reverted.

Its detail pages are `Disallow`ed by robots.txt (`*/careers/position`), so only the listing is
ever fetched — which is all this adapter does.

**Apple** — `jobs.apple.com/en-in/search`, scoped to India (177 roles, 136 of them engineering).

Server-rendered, so despite appearances there is no API to intercept: watching the page produced
no job XHR at all. Rows are `div.job-title.job-list-item`. Its ids are not plain numbers but
`200677836-0321` — a requisition plus a location suffix, so one role open in two cities is two
rows with two ids, as it should be. Its posted dates read `07 Sept 2026`, the one four-letter
month abbreviation no standard format understands, which was silently discarding every date until
`parse_date` learned it.

**Ringg** — six roles as plain anchors on `ringg.ai/careers`. Small enough that the whole board is
one page of static HTML; the slug is the id.

Markup is the least stable thing to depend on, so this adapter treats an item selector that
matches nothing on the first page as a hard error.

---

## Not crawled

**Wint Wealth** — no first-party job board exists. Their site has no careers page (`/careers` is a
404 and nothing career-shaped appears in their sitemap or homepage), and they hire through
aggregators: LinkedIn, Instahyre, Wellfound. There is nothing to crawl rather than something
refusing to be crawled, so it is manual with a link to their LinkedIn jobs tab. If they adopt an
ATS later it becomes a config row like any other.

**Google** — *superseded October 2026.* This entry recorded a `robots.txt` that disallowed the
job results path for every crawler. The file has since changed: that rule now applies to Yandex
alone, and other crawlers are refused only the paginated results. Google is crawled one page at a
time — see [October 2026](#october-2026-the-28-that-had-fallen-back-to-manual).

We do not spoof fingerprints, solve challenges, or rotate identities. Beyond being the right call,
evasion is the *unreliable* one: it breaks constantly and rots silently, which is exactly the
failure mode this project exists to prevent.

---

## Adding a company

1. Paste the careers URL into **Companies → Add**. Greenhouse, Lever, Ashby, SmartRecruiters and
   Workday URLs are recognised automatically and need nothing further.
2. If it is not recognised it is saved as `manual` rather than guessed at, and appears on the
   dashboard as something to check by hand.
3. To promote it, find its JSON — the careers page, its hydration state, its JS bundles, or a
   board it syndicates to — and write a `json_api`, `hydration` or `html_list` config.
   `scripts/record_cassettes.py` captures a fixture, and the conformance suite then applies all
   21 invariants to it automatically.

Before concluding a company cannot be crawled, work through what the last five taught:

- **Read `robots.txt` first.** It is the deciding authority in both directions — Qualcomm's
  *permits* the endpoint that had been assumed forbidden, and Google's forbids one that would
  otherwise work.
- **Try the honest User-Agent on its own.** It is not merely the polite option; twice it was the
  only one that got a 200.
- **Search the first response for the job's title, not only its id.** CHEQ's data was present in a
  shape the earlier search did not look for.
- **Ask who else the company publishes to.** Job syndication turned the hardest block into an
  ordinary config.
- **Check which endpoint returned the error.** Atlassian's 401 was real, and irrelevant.
- **Read `robots.txt` by longest match, not first match.** `urllib.robotparser` reports
  `Disallow: /` + `Allow: /api/pcsx` as forbidden; RFC 9309 says the Allow wins.
- **Re-read `robots.txt` before trusting an old verdict.** Google's changed between visits.
- **On an aggregator, confirm the employer, not the name.** Filter on its id, and check the count
  against the employer's own profile.

A wrong adapter fails quietly; an honest `manual` shows up as work to do. That asymmetry is why
detection never guesses.
