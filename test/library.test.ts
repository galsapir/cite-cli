import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateCiteKey } from "../src/lib/library.js";
import type { CslJson } from "../src/types/index.js";

describe("generateCiteKey", () => {
  const baseCsl: CslJson = {
    id: "test",
    type: "article-journal",
    title: "Test Article",
    author: [{ given: "John", family: "Smith" }],
    issued: { "date-parts": [[2021]] },
  };

  it("generates key from first author + year", () => {
    expect(generateCiteKey(baseCsl, [])).toBe("smith2021");
  });

  it("disambiguates with suffix when key exists", () => {
    expect(generateCiteKey(baseCsl, ["smith2021"])).toBe("smith2021a");
  });

  it("continues disambiguation", () => {
    expect(generateCiteKey(baseCsl, ["smith2021", "smith2021a"])).toBe(
      "smith2021b",
    );
  });

  it("handles missing author", () => {
    const csl: CslJson = { ...baseCsl, author: undefined };
    expect(generateCiteKey(csl, [])).toBe("unknown2021");
  });

  it("handles missing year", () => {
    const csl: CslJson = { ...baseCsl, issued: undefined };
    expect(generateCiteKey(csl, [])).toBe("smith");
  });

  it("handles literal author name", () => {
    const csl: CslJson = {
      ...baseCsl,
      author: [{ literal: "WHO Working Group" }],
    };
    expect(generateCiteKey(csl, [])).toBe("whoworkinggroup2021");
  });

  it("handles raw date format", () => {
    const csl: CslJson = {
      ...baseCsl,
      issued: { raw: "2019-08-10" },
    };
    expect(generateCiteKey(csl, [])).toBe("smith2019");
  });
});
