import { describe, expect, it } from "vitest";
import { formatDevise, mentionConversion, versReference } from "./devises";

describe("versReference", () => {
  it("convertit au taux fourni", () => {
    // 50,00 USD a 0,92 -> 46,00 EUR
    expect(versReference(5000, 0.92)).toBe(4600);
  });

  it("laisse un montant inchange au taux 1", () => {
    expect(versReference(4990, 1)).toBe(4990);
  });

  it("arrondit au centime, une seule fois", () => {
    // 33,33 USD a 0,9137 = 30,4536... -> 30,45 EUR
    expect(versReference(3333, 0.9137)).toBe(3045);
  });

  it("ne derive pas sur les gros montants", () => {
    expect(versReference(123456789, 0.9137)).toBe(Math.round(123456789 * 0.9137));
  });

  it("refuse un taux absurde plutot que de produire un montant faux", () => {
    expect(versReference(5000, 0)).toBeNull();
    expect(versReference(5000, -1)).toBeNull();
    expect(versReference(5000, Number.NaN)).toBeNull();
  });
});

describe("formatDevise", () => {
  it("formate en dollars", () => {
    expect(formatDevise(5000, "USD")).toContain("50,00");
  });

  it("traite un montant absent comme zero", () => {
    expect(formatDevise(null)).toContain("0,00");
  });
});

describe("mentionConversion", () => {
  it("rappelle le montant d'origine et le taux", () => {
    const mention = mentionConversion({ devise: "USD", montant_cents: 5000, taux: 0.92 });
    expect(mention).toContain("50,00");
    expect(mention).toContain("0.92");
  });

  it("n'affiche rien pour un montant deja en euros", () => {
    expect(mentionConversion({ devise: "EUR", montant_cents: 5000, taux: 1 })).toBeNull();
    expect(mentionConversion(null)).toBeNull();
  });
});
