import { describe, expect, it } from "vitest";

import {
  DEFAULT_TEMPLATES,
  extractVariables,
  missingVariables,
  renderTemplate,
  toE164,
  whatsappLink,
  linkedinLink,
} from "./templates";

describe("extractVariables", () => {
  it("finds variables in order, without duplicates", () => {
    expect(extractVariables("Hi {{name}}, a {{role}} at {{company}} — {{name}} again")).toEqual([
      "name",
      "role",
      "company",
    ]);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(extractVariables("{{ name }} and {{role }}")).toEqual(["name", "role"]);
  });

  it("returns nothing for a template with no variables", () => {
    expect(extractVariables("Just a plain message.")).toEqual([]);
  });

  it("ignores single braces and unclosed placeholders", () => {
    expect(extractVariables("{name} and {{unclosed")).toEqual([]);
  });
});

describe("renderTemplate", () => {
  it("substitutes provided values", () => {
    expect(
      renderTemplate("Hi {{name}}, a {{role}} at {{company}}", {
        name: "Chintan",
        role: "SDE 2",
        company: "Databricks",
      }),
    ).toBe("Hi Chintan, a SDE 2 at Databricks");
  });

  // A gap you can see is a gap you fix. Silently sending "Hi , I saw a role at" is the failure
  // this behaviour exists to prevent.
  it("leaves an unfilled variable visible rather than blanking it", () => {
    expect(renderTemplate("Hi {{name}}, a {{role}}", { name: "Arpit" })).toBe(
      "Hi Arpit, a {{role}}",
    );
  });

  it("treats an empty string as unfilled", () => {
    expect(renderTemplate("Hi {{name}}", { name: "" })).toBe("Hi {{name}}");
  });

  it("replaces every occurrence of a repeated variable", () => {
    expect(renderTemplate("{{a}} {{a}} {{a}}", { a: "x" })).toBe("x x x");
  });

  it("does not re-process substituted text", () => {
    // A value that itself looks like a placeholder must not trigger another substitution.
    expect(renderTemplate("{{a}}", { a: "{{b}}", b: "boom" })).toBe("{{b}}");
  });
});

describe("missingVariables", () => {
  it("lists only the unfilled ones", () => {
    expect(
      missingVariables("{{name}} {{role}} {{company}}", { name: "A", company: null }),
    ).toEqual(["role", "company"]);
  });

  it("returns empty when everything is filled", () => {
    expect(missingVariables("{{a}}", { a: "x" })).toEqual([]);
  });
});

// Every number below is from a reserved example range — never a real contact. A test fixture
// lives in git history forever, and other people's phone numbers should not.
describe("toE164", () => {
  it.each([
    ["+919876543210", "919876543210"],
    ["9876543210", "919876543210"],
    ["+91 98765 43210", "919876543210"],
    ["09876543210", "919876543210"],
    ["+1 (202) 555-0143", "12025550143"],
  ])("normalises %s", (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });

  // A wrong wa.me link opens a chat with a stranger, so anything implausible returns null
  // rather than a guess.
  it.each([null, undefined, "", "abc", "12", "1234567890123456789"])(
    "returns null for %s",
    (input) => {
      expect(toE164(input as string)).toBeNull();
    },
  );

  it("keeps an existing country code rather than prefixing India's", () => {
    expect(toE164("+12025550143")).toBe("12025550143");
    expect(toE164("+12025550143")?.startsWith("91")).toBe(false);
  });
});

describe("whatsappLink", () => {
  it("builds an encoded wa.me link", () => {
    const link = whatsappLink("+919876543210", "Hi there & thanks!");
    expect(link).toBe("https://wa.me/919876543210?text=Hi%20there%20%26%20thanks!");
  });

  it("returns null when the number is unusable, so the UI can hide the action", () => {
    expect(whatsappLink(null, "hi")).toBeNull();
    expect(whatsappLink("nope", "hi")).toBeNull();
  });
});

describe("default templates", () => {
  it("ships the three the PRD describes", () => {
    expect(DEFAULT_TEMPLATES).toHaveLength(3);
  });

  it("only uses variables the app knows how to fill", () => {
    const known = new Set([
      "name",
      "company",
      "role",
      "job_link",
      "resume_link",
      "your_name",
    ]);
    for (const t of DEFAULT_TEMPLATES) {
      for (const v of extractVariables(t.body)) {
        expect(known.has(v), `${t.name} uses unknown variable ${v}`).toBe(true);
      }
    }
  });

  it("renders cleanly once every variable is supplied", () => {
    const values = {
      name: "Chintan",
      company: "Databricks",
      role: "Product Designer",
      job_link: "https://example.com/job",
      resume_link: "https://example.com/cv",
      your_name: "Akhilesh",
    };
    for (const t of DEFAULT_TEMPLATES) {
      expect(missingVariables(t.body, values)).toEqual([]);
      expect(renderTemplate(t.body, values)).not.toContain("{{");
    }
  });
});

describe("linkedinLink", () => {
  it.each([
    ["https://www.linkedin.com/in/sarthak-ahuja", "https://www.linkedin.com/in/sarthak-ahuja"],
    ["linkedin.com/in/manav", "https://www.linkedin.com/in/manav"],
    ["www.linkedin.com/in/manav/", "https://www.linkedin.com/in/manav"],
    ["manav-gupta", "https://www.linkedin.com/in/manav-gupta"],
  ])("normalises %s", (input, expected) => {
    expect(linkedinLink(input)).toBe(expected);
  });

  it.each([null, undefined, "", "   ", "https://twitter.com/someone", "a"])(
    "rejects %s",
    (input) => {
      expect(linkedinLink(input)).toBeNull();
    },
  );
});
