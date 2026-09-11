import { describe, expect, it } from "vitest";
import { bornesPeriode, libellePeriode, PERIODES, PERIODE_DEFAUT } from "./periodes";
import { moisEntre } from "./format";

const AUJOURDHUI = "2026-09-12";

describe("bornesPeriode", () => {
  it("borne le mois en cours a son dernier jour reel", () => {
    expect(bornesPeriode("mois", AUJOURDHUI)).toEqual({
      debut: "2026-09-01",
      fin: "2026-09-30",
    });
  });

  it("gere un mois de 31 jours et fevrier", () => {
    expect(bornesPeriode("mois", "2026-01-15").fin).toBe("2026-01-31");
    expect(bornesPeriode("mois", "2026-02-15").fin).toBe("2026-02-28");
    expect(bornesPeriode("mois", "2028-02-15").fin).toBe("2028-02-29");
  });

  it("couvre l'annee civile entiere", () => {
    expect(bornesPeriode("annee", AUJOURDHUI)).toEqual({
      debut: "2026-01-01",
      fin: "2026-12-31",
    });
  });

  it("remonte a l'annee precedente sans deborder", () => {
    expect(bornesPeriode("annee_precedente", AUJOURDHUI)).toEqual({
      debut: "2025-01-01",
      fin: "2025-12-31",
    });
  });

  it("couvre exactement douze mois entiers", () => {
    // On compte les mois plutot que de coder une date en dur: c'est la
    // propriete qui compte, et elle doit tenir quel que soit le mois courant.
    for (const jour of ["2026-09-12", "2026-01-31", "2026-02-10", "2026-12-01"]) {
      const { debut, fin } = bornesPeriode("12mois", jour);
      expect(moisEntre(debut, fin)).toHaveLength(12);
    }
  });

  it("demarre un 1er et finit un dernier jour de mois", () => {
    const { debut, fin } = bornesPeriode("12mois", AUJOURDHUI);
    expect(debut.endsWith("-01")).toBe(true);
    expect(fin).toBe("2026-09-30");
  });

  it("englobe tout l'historique avec 'depuis toujours'", () => {
    const bornes = bornesPeriode("toujours", AUJOURDHUI);
    expect(bornes.debut < "1900-01-01").toBe(true);
    expect(bornes.fin).toBe("2026-12-31");
  });

  it("retombe sur la periode par defaut pour une cle inconnue", () => {
    expect(bornesPeriode("n-importe-quoi", AUJOURDHUI)).toEqual(
      bornesPeriode(PERIODE_DEFAUT, AUJOURDHUI),
    );
  });

  it("produit des bornes ordonnees pour chaque periode proposee", () => {
    for (const { cle } of PERIODES) {
      const { debut, fin } = bornesPeriode(cle, AUJOURDHUI);
      expect(debut <= fin).toBe(true);
    }
  });
});

describe("libellePeriode", () => {
  it("donne un libelle a chaque periode", () => {
    for (const { cle, libelle } of PERIODES) {
      expect(libellePeriode(cle)).toBe(libelle);
    }
  });
});
