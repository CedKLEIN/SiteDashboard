import { describe, expect, it } from "vitest";
import {
  moisEntre,
  derniersMois,
  aujourdhuiIso,
  joursDepuis,
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


describe("moisEntre", () => {
  it("liste les mois d'une annee", () => {
    expect(moisEntre("2026-01-01", "2026-12-31")).toHaveLength(12);
  });

  it("franchit les annees", () => {
    expect(moisEntre("2025-11-01", "2026-02-28")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("renvoie un seul mois quand les bornes sont dans le meme mois", () => {
    expect(moisEntre("2026-09-01", "2026-09-30")).toEqual(["2026-09"]);
  });

  it("renvoie une liste vide si les bornes sont inversees", () => {
    expect(moisEntre("2026-09-01", "2026-08-01")).toEqual([]);
  });

  it("borne la serie plutot que de boucler sur une date aberrante", () => {
    expect(moisEntre("0001-01-01", "2026-12-31").length).toBeLessThanOrEqual(601);
  });
});

describe("joursDepuis", () => {
  const maintenant = new Date("2026-09-17T13:00:00");

  it("compte les jours entiers depuis un horodatage SQLite", () => {
    expect(joursDepuis("2026-09-14 08:30:00", maintenant)).toBe(3);
  });

  it("renvoie 0 le jour meme", () => {
    expect(joursDepuis("2026-09-17 09:00:00", maintenant)).toBe(0);
  });

  it("ne descend pas sous zero sur un horodatage dans le futur", () => {
    expect(joursDepuis("2026-09-20 09:00:00", maintenant)).toBe(0);
  });

  it("renvoie null sur une saisie inexploitable", () => {
    expect(joursDepuis(null, maintenant)).toBeNull();
    expect(joursDepuis("", maintenant)).toBeNull();
    expect(joursDepuis("jamais", maintenant)).toBeNull();
  });
});
