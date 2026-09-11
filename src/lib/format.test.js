import { describe, expect, it } from "vitest";
import {
  derniersMois,
  aujourdhuiIso,
  moisIso,
  parseMontant,
} from "./format";

describe("parseMontant", () => {
  it("accepte la virgule et le point", () => {
    expect(parseMontant("12,50")).toBe(1250);
    expect(parseMontant("12.50")).toBe(1250);
  });

  it("tolere espaces et symbole monetaire", () => {
    expect(parseMontant(" 1200 € ")).toBe(120000);
  });

  it("arrondit au centime sans derive flottante", () => {
    expect(parseMontant("19.99")).toBe(1999);
    expect(parseMontant(0.07)).toBe(7);
  });

  it("rejette ce qui n'est pas un montant", () => {
    expect(parseMontant("abc")).toBeNull();
    expect(parseMontant("")).toBeNull();
    expect(parseMontant(null)).toBeNull();
  });
});

describe("dates", () => {
  it("extrait le mois ISO", () => {
    expect(moisIso("2026-09-11")).toBe("2026-09");
  });

  it("formate la date locale, pas UTC", () => {
    expect(aujourdhuiIso(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("remonte les n derniers mois en franchissant l'annee", () => {
    expect(derniersMois(3, new Date(2026, 1, 15))).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });
});

