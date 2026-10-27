import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => 0.9) }));
const { convertirVersReference, partsEnReference } = await import("./conversion");

describe("convertirVersReference", () => {
  it("laisse un montant en euros tel quel", async () => {
    expect(await convertirVersReference({ montantCents: 1234, devise: "EUR", date: "2026-10-01" })).toEqual({
      taux: 1,
      montantEurCents: 1234,
    });
  });

  it("convertit au taux du jour de l'operation", async () => {
    expect(await convertirVersReference({ montantCents: 2000, devise: "USD", date: "2026-10-01" })).toEqual({
      taux: 0.9,
      montantEurCents: 1800,
    });
  });
});

describe("partsEnReference", () => {
  it("ne touche ni a des parts egales ni a un montant en euros", () => {
    expect(partsEnReference(null, 2000, 1800)).toBeNull();
    expect(partsEnReference([700, 300], 1000, 1000)).toEqual([700, 300]);
  });

  it("ramene des parts en dollars sur le total en euros, proportions gardees", () => {
    const parts = partsEnReference([1500, 500], 2000, 1801);
    expect(parts.reduce((t, p) => t + p, 0)).toBe(1801);
    expect(parts).toEqual([1351, 450]);
  });

  it("refuse des parts qui ne font pas le montant saisi", () => {
    expect(() => partsEnReference([1000, 500], 2000, 1800)).toThrow(/somme des parts/);
  });
});
