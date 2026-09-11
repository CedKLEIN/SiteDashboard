import { describe, expect, it } from "vitest";
import { construireSerie } from "./series";

const VIDE = new Map();

function serie(options) {
  return construireSerie({
    debut: "2026-01-01",
    fin: "2026-03-31",
    parMois: VIDE,
    aboParMois: VIDE,
    ...options,
  });
}

describe("construireSerie", () => {
  it("produit un point par mois de la periode, meme sans ecriture", () => {
    expect(serie({}).points).toHaveLength(3);
  });

  it("cumule les depenses de mois en mois", () => {
    const parMois = new Map([
      ["2026-01", { depense_cents: 1000, revenu_cents: 0 }],
      ["2026-02", { depense_cents: 500, revenu_cents: 0 }],
    ]);
    const { points, totalDepensesCents } = serie({ parMois });

    expect(points.map((p) => p.cumulDepenses)).toEqual([10, 15, 15]);
    expect(totalDepensesCents).toBe(1500);
  });

  it("ajoute les abonnements aux depenses cumulees", () => {
    const parMois = new Map([["2026-01", { depense_cents: 1000, revenu_cents: 0 }]]);
    const aboParMois = new Map([
      ["2026-01", 1080],
      ["2026-02", 1080],
    ]);
    const { points, totalDepensesCents, totalAbonnementsCents } = serie({ parMois, aboParMois });

    expect(points[0].cumulDepenses).toBe(20.8);
    expect(totalDepensesCents).toBe(3160);
    expect(totalAbonnementsCents).toBe(2160);
  });

  it("montre les revenus rattrapant les depenses", () => {
    // Le cas qui motive le graphe: on depense tot, les revenus arrivent apres
    const parMois = new Map([
      ["2026-01", { depense_cents: 3000, revenu_cents: 0 }],
      ["2026-02", { depense_cents: 0, revenu_cents: 1000 }],
      ["2026-03", { depense_cents: 0, revenu_cents: 2500 }],
    ]);
    const { points } = serie({ parMois });

    expect(points.map((p) => p.cumulRevenus)).toEqual([0, 10, 35]);
    expect(points[0].cumulRevenus < points[0].cumulDepenses).toBe(true);
    // Au troisieme mois les revenus sont passes devant
    expect(points[2].cumulRevenus > points[2].cumulDepenses).toBe(true);
  });

  it("ignore un abonnement hors de la periode affichee", () => {
    const aboParMois = new Map([["2025-12", 9999]]);
    expect(serie({ aboParMois }).totalAbonnementsCents).toBe(0);
  });

  it("renvoie une serie vide quand les bornes sont inversees", () => {
    const { points, totalDepensesCents } = serie({ debut: "2026-03-01", fin: "2026-01-31" });
    expect(points).toEqual([]);
    expect(totalDepensesCents).toBe(0);
  });

  it("ne depend pas du nombre d'appels: le cumul repart de zero", () => {
    const parMois = new Map([["2026-01", { depense_cents: 1000, revenu_cents: 0 }]]);
    const premier = serie({ parMois }).totalDepensesCents;
    const second = serie({ parMois }).totalDepensesCents;
    expect(second).toBe(premier);
  });
});
