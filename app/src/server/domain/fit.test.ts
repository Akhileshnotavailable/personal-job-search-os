import { describe, expect, it } from "vitest";

import { bandFor, DEFAULT_FIT_PROFILE, scoreFit, type FitInput } from "./fit";

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

function job(over: Partial<FitInput> = {}): FitInput {
  return {
    title: "Product Designer",
    description: null,
    locationPriority: 1,
    postedAt: daysAgo(1),
    ...over,
  };
}

const PRODUCT_DESIGN = `
  You will own our design system end to end, from tokens to components, and prototype in
  Figma to explore interaction design and user flows before a single line of code is written.
  You will run user research and usability testing to validate concepts, shape the information
  architecture of a growing B2B dashboard, and use Mixpanel and Google Analytics to make
  data-informed design decisions. You will partner closely with engineering and product.
`;

// Deliberately the same length class as PRODUCT_DESIGN. A short description trips the
// title-only path, which shrinks the denominator and *raises* the score -- comparing a long
// description against a short one measures that mechanism rather than fit.
const BACKEND_ONLY = `
  We are looking for a backend engineer to work on our distributed systems platform.
  You will write Go services, work with Kafka event streaming, PostgreSQL and Redis,
  and deploy on Kubernetes. Experience with microservices and gRPC is a plus.
`;

describe("level", () => {
  it("rewards a title that names the exact band", () => {
    const exact = scoreFit(job({ title: "Product Designer" }));
    const vague = scoreFit(job({ title: "Designer" }));
    expect(exact.score).toBeGreaterThan(vague.score);
  });

  it.each([
    "Product Designer",
    "Senior Product Designer",
  ])("reads %s as the exact band", (title) => {
    const level = scoreFit(job({ title })).signals.find((s) => s.dimension === "level");
    expect(level?.label).toBe("Exact level");
  });

  it("ranks a level below the band lower than an unlevelled title", () => {
    const below = scoreFit(job({ title: "Associate Product Designer" }));
    const adjacent = scoreFit(job({ title: "UX Designer" }));
    expect(below.score).toBeLessThan(adjacent.score);
  });
});

describe("skills", () => {
  it("scores a design-systems posting far above a backend one", () => {
    const good = scoreFit(job({ description: PRODUCT_DESIGN }));
    const bad = scoreFit(job({ description: BACKEND_ONLY }));
    expect(good.score).toBeGreaterThan(bad.score + 20);
  });

  it("names the matched skill areas so the score can be argued with", () => {
    const skills = scoreFit(job({ description: PRODUCT_DESIGN })).signals.find(
      (s) => s.dimension === "skills",
    );
    expect(skills?.label).toContain("Design systems");
  });

  // A long description mentioning everything must not beat a focused one. Otherwise the model
  // ranks how verbose a job ad is, which is not a property of the job.
  it("does not let a technology-listing description outrank a focused match", () => {
    const focused = scoreFit(job({ description: PRODUCT_DESIGN }));
    const kitchenSink = scoreFit(
      job({
        description:
          PRODUCT_DESIGN +
          " Also COBOL, Fortran, Perl, Haskell, Scala, Ruby, PHP, Swift, Kotlin, Rust, Elixir.",
      }),
    );
    expect(kitchenSink.score).toBeLessThanOrEqual(focused.score + 2);
  });
});

describe("missing descriptions", () => {
  // Apple, Microsoft and Rippling publish no description on their list endpoints. Ranking those
  // last would penalise a gap in our data rather than a flaw in the job.
  it("marks a description-less job as title-only", () => {
    expect(scoreFit(job({ description: null })).titleOnly).toBe(true);
    expect(scoreFit(job({ description: PRODUCT_DESIGN })).titleOnly).toBe(false);
  });

  it("does not bury a good title just because the description is absent", () => {
    const bare = scoreFit(job({ title: "Product Designer", description: null }));
    expect(bare.score).toBeGreaterThanOrEqual(DEFAULT_FIT_PROFILE.bands.good);
  });

  it("assesses less total weight when there is no description", () => {
    const bare = scoreFit(job({ description: null }));
    const full = scoreFit(job({ description: PRODUCT_DESIGN }));
    expect(bare.assessedWeight).toBeLessThan(full.assessedWeight);
  });

  it("still reads skills out of a descriptive title", () => {
    const withSkill = scoreFit(job({ title: "Product Designer - Design Systems" }));
    const without = scoreFit(job({ title: "Product Designer" }));
    expect(withSkill.score).toBeGreaterThan(without.score);
  });
});

describe("location", () => {
  it("ranks Bangalore above Gurgaon above Remote above Hyderabad", () => {
    const at = (p: number) => scoreFit(job({ locationPriority: p })).score;
    expect(at(1)).toBeGreaterThan(at(2));
    expect(at(2)).toBeGreaterThan(at(3));
    expect(at(3)).toBeGreaterThan(at(4));
  });

  // Amazon and Apple omit a per-row location while the query is already scoped to India.
  it("treats an unknown location as mid-scale, not as a failure", () => {
    const unknown = scoreFit(job({ locationPriority: null })).score;
    expect(unknown).toBeGreaterThan(scoreFit(job({ locationPriority: 4 })).score);
    expect(unknown).toBeLessThan(scoreFit(job({ locationPriority: 1 })).score);
  });
});

describe("freshness", () => {
  it("prefers a posting from today over one from last month", () => {
    expect(scoreFit(job({ postedAt: daysAgo(1) })).score).toBeGreaterThan(
      scoreFit(job({ postedAt: daysAgo(45) })).score,
    );
  });

  it("falls back to discovery date when the source gives no posted date", () => {
    const s = scoreFit({ ...job({ postedAt: null }), discoveredAt: daysAgo(1) });
    expect(s.signals.find((x) => x.dimension === "freshness")?.label).toBe("Fresh");
  });

  it("is neutral, not punitive, when no date exists at all", () => {
    const s = scoreFit({ ...job({ postedAt: null }), discoveredAt: null });
    expect(s.signals.find((x) => x.dimension === "freshness")?.detail).toMatch(/No posting date/);
  });
});

describe("bands and shape", () => {
  it("puts the ideal job in the top band", () => {
    const ideal = scoreFit({
      title: "Senior Product Designer, B2B Dashboard",
      description: PRODUCT_DESIGN + " You will own our merchant partner portal end to end.",
      locationPriority: 1,
      postedAt: daysAgo(1),
    });
    expect(ideal.band).toBe("excellent");
  });

  it("puts an off-profile job in a low band", () => {
    const poor = scoreFit({
      title: "Backend Engineer",
      description: BACKEND_ONLY,
      locationPriority: 4,
      postedAt: daysAgo(60),
    });
    expect(["weak", "fair"]).toContain(poor.band);
  });

  it("always produces a score inside 0-100", () => {
    for (const t of ["", "Product Designer", "Chief Happiness Officer"]) {
      for (const p of [null, 1, 4]) {
        const s = scoreFit({ title: t, locationPriority: p, postedAt: daysAgo(5) });
        expect(s.score).toBeGreaterThanOrEqual(0);
        expect(s.score).toBeLessThanOrEqual(100);
      }
    }
  });

  it("is deterministic", () => {
    const input = job({ description: PRODUCT_DESIGN });
    expect(scoreFit(input).score).toBe(scoreFit(input).score);
  });

  it("every signal carries a label and a reason", () => {
    for (const s of scoreFit(job({ description: PRODUCT_DESIGN })).signals) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.detail.length).toBeGreaterThan(0);
    }
  });

  it("orders signals by contribution so the UI can show the top few", () => {
    const pts = scoreFit(job({ description: PRODUCT_DESIGN })).signals.map((s) => s.points);
    expect([...pts].sort((a, b) => b - a)).toEqual(pts);
  });

  it.each([
    [95, "excellent"],
    [80, "excellent"],
    [79, "strong"],
    [65, "strong"],
    [50, "good"],
    [35, "fair"],
    [10, "weak"],
  ])("maps %i to %s", (score, band) => {
    expect(bandFor(score)).toBe(band);
  });
});
