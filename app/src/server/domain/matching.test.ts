import { describe, expect, it } from "vitest";

import {
  DEFAULT_MATCH_RULES,
  matchJob,
  matchLocation,
  matchTitle,
  parseRequiredYears,
} from "./matching";

const BLR = "Bengaluru, Karnataka, India";

describe("matchTitle", () => {
  it.each([
    ["Product Designer", "Product Designer"],
    ["Senior Product Designer", "Senior Product Designer"],
    ["UX/UI Designer", "UX/UI Designer"],
    ["Senior UX Designer", "Senior UX Designer"],
    ["UX Designer", "UX Designer"],
    ["UI Designer", "UI Designer"],
    ["Interaction Designer", "Interaction Designer"],
  ])("accepts %s", (title, label) => {
    const r = matchTitle(title);
    expect(r.passed).toBe(true);
    expect(r.label).toBe(label);
  });

  it.each([
    "Staff Product Designer",
    "Principal Product Designer",
    "Design Lead",
    "Head of Design",
    "Director of Product Design",
    "VP of Design",
    "Design Manager",
    "Product Designer Intern",
    "New Grad Product Designer",
    "Junior Product Designer",
    "Associate Product Designer",
    "Product Manager",
    "Solutions Engineer",
    "Technical Writer",
  ])("rejects %s", (title) => {
    expect(matchTitle(title).passed).toBe(false);
  });

  it.each([
    "Product Designer, Growth",
    "Senior Product Designer, Checkout Experience",
    "Product Designer - Platform",
    "UX Designer, Onboarding",
  ])("accepts real-world suffixed title %s", (title) => {
    expect(matchTitle(title).passed).toBe(true);
  });

  it("prefers the highest-scoring pattern when several match", () => {
    // "Senior UX/UI Designer" matches both the generic UX Designer rule and the senior UX/UI rule.
    const r = matchTitle("Senior UX/UI Designer");
    expect(r.passed).toBe(true);
    expect(r.score).toBe(95);
  });

  it("keeps the unlevelled 'Designer' title, which startups use, at a lower score", () => {
    const r = matchTitle("Designer");
    expect(r.passed).toBe(true);
    expect(r.score).toBeLessThan(matchTitle("Product Designer").score);
  });
});

describe("parseRequiredYears", () => {
  it.each([
    ["3+ years of experience in product design", 3],
    ["4+ years of professional experience", 4],
    ["Minimum of 8 years in design", 8],
    ["At least 5 years of relevant experience", 5],
    ["<p>3-5 years of industry experience</p>", 3],
    ["Experience: 6 years", 6],
  ])("parses %s -> %i", (text, expected) => {
    expect(parseRequiredYears(text)).toBe(expected);
  });

  it("returns null when no requirement is stated", () => {
    expect(parseRequiredYears("We value curiosity and craft.")).toBeNull();
    expect(parseRequiredYears(null)).toBeNull();
  });

  it("takes the smallest figure when several are mentioned", () => {
    // Leniency is deliberate: a false negative loses the role entirely.
    expect(
      parseRequiredYears("3+ years in product design. 8+ years of overall experience preferred."),
    ).toBe(3);
  });

  it("ignores implausible numbers", () => {
    expect(parseRequiredYears("Founded 2011 years ago experience")).toBeNull();
  });
});

describe("matchLocation", () => {
  it.each([
    ["Bengaluru, India", "Bangalore"],
    ["Bangalore", "Bangalore"],
    ["Gurugram, Haryana", "Gurgaon"],
    ["Remote - India", "Remote"],
    ["Hyderabad, Telangana", "Hyderabad"],
  ])("maps %s -> %s", (input, name) => {
    expect(matchLocation(input).matched?.name).toBe(name);
  });

  // Regression: DirectEmployers-syndicated boards (Akamai) write remote roles as
  // "Virtual, IND". Without "virtual" as an alias all such India openings would be dropped on
  // location no matter what the title said -- a silent miss, not a visible one.
  it.each([
    "Virtual, IND, India",
    "Virtual, IND",
  ])("treats %s as Remote", (input) => {
    expect(matchLocation(input).matched?.name).toBe("Remote");
  });

  // ...and the alias stays safe only because reject runs before allow. The same feed carries
  // "Virtual, POL", which must not become a match just because it says virtual.
  it.each([
    "Virtual, POL, Poland",
    "Virtual, DEU, Germany",
  ])("still rejects %s", (input) => {
    expect(matchLocation(input).matched).toBeNull();
  });

  it("rejects locations outside the allow list", () => {
    expect(matchLocation("US, CA, Santa Clara").matched).toBeNull();
    expect(matchLocation("US, CA, Santa Clara").unknown).toBe(false);
  });

  it.each([
    "Italy, Remote",
    "Canada, Remote",
    "US, FL, Remote",
    "Australia, Remote",
    "UK, Remote",
    "Germany, Munich",
  ])("rejects foreign location %s even when it says Remote", (location) => {
    expect(matchLocation(location).matched).toBeNull();
    expect(matchLocation(location).unknown).toBe(false);
  });

  it.each(["India, Remote", "Remote - India", "Remote", "Bengaluru, India"])(
    "still accepts %s",
    (location) => {
      expect(matchLocation(location).matched).not.toBeNull();
    },
  );

  it("reports an empty location as unknown rather than rejected", () => {
    expect(matchLocation(null).unknown).toBe(true);
    expect(matchLocation("").unknown).toBe(true);
  });

  it("picks the highest-priority location when a posting lists several", () => {
    expect(matchLocation("Hyderabad or Bengaluru").matched?.name).toBe("Bangalore");
  });
});

describe("matchJob", () => {
  it("accepts an ideal role", () => {
    const r = matchJob({
      title: "Product Designer",
      location: BLR,
      description: "3+ years of experience.",
    });
    expect(r.isRelevant).toBe(true);
    expect(r.score).toBe(140); // 100 title + 40 Bangalore
    expect(r.locationPriority).toBe(1);
    expect(r.reason).toContain("fits");
  });

  it("rejects an out-of-scope location even with a perfect title", () => {
    const r = matchJob({
      title: "Product Designer",
      location: "US, CA, Santa Clara",
      description: "3+ years",
    });
    expect(r.isRelevant).toBe(false);
    expect(r.reason).toContain("not in the allowed list");
  });

  it("rejects a role demanding far more experience", () => {
    const r = matchJob({
      title: "Product Designer",
      location: BLR,
      description: "Minimum of 9 years of experience required.",
    });
    expect(r.isRelevant).toBe(false);
    expect(r.requiredYears).toBe(9);
  });

  it("rejects a role right at the 6-year hard cutoff, not just above it", () => {
    const r = matchJob({
      title: "Product Designer",
      location: BLR,
      description: "6+ years of experience.",
    });
    expect(r.isRelevant).toBe(false);
    expect(r.reason).toMatch(/reject threshold/);
  });

  it("keeps a job whose description states no experience requirement", () => {
    const r = matchJob({ title: "Senior Product Designer", location: BLR, description: null });
    expect(r.isRelevant).toBe(true);
    expect(r.reason).toContain("experience not stated");
  });

  it("keeps a job with no location rather than silently dropping it", () => {
    const r = matchJob({ title: "Senior Product Designer", location: null });
    expect(r.isRelevant).toBe(true);
    expect(r.locationPriority).toBeNull();
  });

  it("ranks the four locations in priority order", () => {
    const at = (location: string) => matchJob({ title: "Product Designer", location });
    const blr = at("Bengaluru");
    const ggn = at("Gurugram");
    const rem = at("Remote");
    const hyd = at("Hyderabad");

    expect([blr, ggn, rem, hyd].map((r) => r.locationPriority)).toEqual([1, 2, 3, 4]);
    expect(blr.score).toBeGreaterThan(ggn.score);
    expect(ggn.score).toBeGreaterThan(rem.score);
    expect(rem.score).toBeGreaterThan(hyd.score);
  });

  it("always explains itself", () => {
    for (const job of [
      { title: "Product Designer", location: BLR },
      { title: "Design Manager", location: BLR },
      { title: "Product Designer", location: "Dublin, Ireland" },
    ]) {
      expect(matchJob(job).reason.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic", () => {
    const job = { title: "Senior Product Designer", location: BLR, description: "4+ years" };
    expect(matchJob(job)).toEqual(matchJob(job));
  });

  it("honours a caller-supplied rule set instead of the default", () => {
    const strict = {
      ...DEFAULT_MATCH_RULES,
      location: { ...DEFAULT_MATCH_RULES.location, unknownPasses: false },
    };
    expect(matchJob({ title: "Senior Product Designer", location: null }, strict).isRelevant).toBe(false);
  });
});

// Product design shares vocabulary with several neighbouring disciplines that are not the
// target role -- graphic, game, and web design, plus UX research.
describe("matchTitle — adjacent design disciplines are excluded", () => {
  it.each([
    "Graphic Designer",
    "Game Designer",
    "Web Designer",
    "Motion Designer",
    "Industrial Designer",
    "UX Researcher",
    "User Researcher",
    "Design Researcher",
  ])("rejects %s", (title) => {
    expect(matchTitle(title).passed).toBe(false);
  });

  it.each([
    "Product Designer",
    "Senior Product Designer",
    "UX Designer",
    "UI Designer",
    "Visual Designer",
    "Interaction Designer",
  ])("still accepts core product design title %s", (title) => {
    expect(matchTitle(title).passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Per-company level vocabulary
// ---------------------------------------------------------------------------

describe("company match overrides", () => {
  // Some companies use "Design Lead" as their IC ceiling rather than a management title, so the
  // global `lead` exclusion would otherwise drop every senior-level opening at that company.
  const startupX = { levelTitles: ["design lead"] };
  const google = { levelTitles: ["ux designer iii"] };

  it("lifts a seniority exclusion for the company that declared it", () => {
    expect(matchTitle("Design Lead - Startup X").passed).toBe(false);
    expect(matchTitle("Design Lead - Startup X", DEFAULT_MATCH_RULES, startupX).passed).toBe(true);
  });

  it("lifts it only for that company", () => {
    expect(matchTitle("Design Lead", DEFAULT_MATCH_RULES, google).passed).toBe(false);
    expect(matchTitle("UX Designer III", DEFAULT_MATCH_RULES, google).passed).toBe(true);
  });

  // The important limit: a level override says "this level is mine here", not "any job here".
  it("never lifts a discipline exclusion", () => {
    for (const title of [
      "Design Lead, Graphic Design",
      "Design Lead, UX Research",
      "Game Design Lead",
    ]) {
      expect(matchTitle(title, DEFAULT_MATCH_RULES, startupX).passed).toBe(false);
    }
  });

  it("still rejects levels the company did not declare", () => {
    expect(matchTitle("Director of Design - Startup X", DEFAULT_MATCH_RULES, startupX).passed).toBe(false);
    expect(matchTitle("Head of Design - Startup X", DEFAULT_MATCH_RULES, startupX).passed).toBe(false);
  });

  it("explains itself, naming the pattern that matched", () => {
    const r = matchTitle("Design Lead", DEFAULT_MATCH_RULES, startupX);
    expect(r.label).toContain("design lead");
  });

  it("keeps the better label when an ordinary include already scores higher", () => {
    // "Product Designer" scores 100; an override at a lower score must not overwrite it.
    const r = matchTitle("Product Designer", DEFAULT_MATCH_RULES, { levelTitles: ["product designer"], score: 70 });
    expect(r.label).toBe("Product Designer");
    expect(r.score).toBe(100);
  });

  it("is inert when the company has none", () => {
    for (const o of [undefined, null, { levelTitles: [] }]) {
      expect(matchTitle("Design Lead", DEFAULT_MATCH_RULES, o).passed).toBe(false);
      expect(matchTitle("Product Designer", DEFAULT_MATCH_RULES, o).passed).toBe(true);
    }
  });

  it("survives a malformed pattern rather than breaking every match", () => {
    const bad = { levelTitles: ["design lead", "([unclosed"] };
    expect(matchTitle("Design Lead", DEFAULT_MATCH_RULES, bad).passed).toBe(true);
  });

  it("flows through matchJob with location and experience still applying", () => {
    const m = matchJob(
      { title: "Design Lead", location: "Bangalore, India", description: null },
      DEFAULT_MATCH_RULES,
      startupX,
    );
    expect(m.isRelevant).toBe(true);
    const abroad = matchJob(
      { title: "Design Lead", location: "Austin, Texas", description: null },
      DEFAULT_MATCH_RULES,
      startupX,
    );
    expect(abroad.isRelevant).toBe(false);
  });
});

describe("years-of-experience band", () => {
  // 3-5 years is the eligible band, a ranking signal at the low end and a gate only at the
  // extreme: a role below the band is only worth ranking down. 6+ is a hard gate, not a soft
  // penalty -- there is no tolerated-but-deprioritised tier above 5.
  const job = (description: string) => ({
    title: "Product Designer",
    location: "Bengaluru, India",
    description,
  });

  it.each([3, 4, 5])("treats %i+ years as a clean fit", (y) => {
    const m = matchJob(job(`We are looking for ${y}+ years of experience.`));
    expect(m.isRelevant).toBe(true);
    expect(m.reason).toContain("fits 3-5");
  });

  it("ranks a role below the band down without hiding it", () => {
    const under = matchJob(job("1+ years of experience required."));
    const inBand = matchJob(job("3+ years of experience required."));
    expect(under.score).toBeLessThan(inBand.score);
    expect(under.reason).toMatch(/below the 3-5 band/);
  });

  it("hard-rejects at the 6-year cutoff, not just above it", () => {
    const m = matchJob(job("6+ years of experience required."));
    expect(m.isRelevant).toBe(false);
    expect(m.reason).toMatch(/reject threshold/);
  });

  it("still hard-rejects the genuinely out-of-reach", () => {
    const m = matchJob(job("12+ years of experience required."));
    expect(m.isRelevant).toBe(false);
    expect(m.reason).toMatch(/reject threshold/);
  });

  it("keeps a job whose description never states a requirement", () => {
    const m = matchJob(job("Come build great things with us."));
    expect(m.isRelevant).toBe(true);
    expect(m.reason).toContain("experience not stated");
  });
});

describe("location regions, not only countries", () => {
  // Regression: some ATS boards post "CA Remote Ontario" -- no country named, so a country-only
  // reject list would accept it as plain "Remote" and put a Canadian role on the board. The same
  // failure as "Italy, Remote", one level down the hierarchy.
  it.each([
    "CA Remote Ontario",
    "Remote, Ontario, Canada",
    "Toronto",
    "Remote - Vancouver",
  ])("rejects %s", (loc) => {
    expect(matchLocation(loc).matched).toBeNull();
  });

  it("still accepts a genuine Indian remote role", () => {
    expect(matchLocation("Remote - India").matched?.name).toBe("Remote");
    expect(matchLocation("IN Remote India").matched?.name).toBe("Remote");
  });
});
