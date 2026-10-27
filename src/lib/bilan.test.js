import { describe, expect, it } from "vitest";
import { ecart, unAnAvant } from "./bilan";

describe("bilan", () => {
  it("recule d'un an, 29 fevrier compris", () => {
    expect(unAnAvant("2026-10-27")).toBe("2025-10-27");
    expect(unAnAvant("2028-02-29")).toBe("2027-02-28");
  });

  it("formate un ecart, et n'en donne pas a partir de zero", () => {
    expect(ecart(118, 100)).toBe("+18 %");
    expect(ecart(94, 100)).toBe("−6 %");
    expect(ecart(-50, -100)).toBe("+50 %");
    expect(ecart(100, 0)).toBeNull();
  });
});
