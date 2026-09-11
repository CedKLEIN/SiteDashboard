import { describe, expect, it } from "vitest";
import {
  ajouterMois,
  coutMensuelEquivalent,
  echeancesPassees,
  prochaineEcheance,
  tarifApplicable,
  totalPaye,
} from "./abonnements";

describe("ajouterMois", () => {
  it("avance d'un mois", () => {
    expect(ajouterMois("2026-01-15", 1)).toBe("2026-02-15");
  });

  it("borne au dernier jour du mois cible", () => {
    // Le 31 fevrier n'existe pas: on ne doit pas deborder sur mars
    expect(ajouterMois("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("gere les annees bissextiles", () => {
    expect(ajouterMois("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("franchit l'annee", () => {
    expect(ajouterMois("2026-11-15", 3)).toBe("2027-02-15");
  });
});

describe("echeancesPassees", () => {
  it("compte le premier paiement: on paie a la souscription", () => {
    expect(echeancesPassees("2026-09-01", "mensuel", "2026-09-01")).toEqual(["2026-09-01"]);
  });

  it("liste les prelevements mensuels jusqu'a aujourd'hui", () => {
    expect(echeancesPassees("2026-07-10", "mensuel", "2026-09-15")).toEqual([
      "2026-07-10",
      "2026-08-10",
      "2026-09-10",
    ]);
  });

  it("n'inclut pas une echeance a venir", () => {
    expect(echeancesPassees("2026-07-10", "mensuel", "2026-09-09")).toHaveLength(2);
  });

  it("compte les annees pour un abonnement annuel", () => {
    expect(echeancesPassees("2024-03-01", "annuel", "2026-09-11")).toEqual([
      "2024-03-01",
      "2025-03-01",
      "2026-03-01",
    ]);
  });

  it("renvoie une liste vide si le debut est dans le futur", () => {
    expect(echeancesPassees("2027-01-01", "mensuel", "2026-09-11")).toEqual([]);
  });

  it("tolere une date de debut absente", () => {
    expect(echeancesPassees(null, "mensuel", "2026-09-11")).toEqual([]);
  });
});

describe("tarifApplicable", () => {
  const tarifs = [
    { debut: "2024-03-01", montant_cents: 600 },
    { debut: "2025-03-01", montant_cents: 1100 },
  ];

  it("prend le tarif en vigueur a la date demandee", () => {
    expect(tarifApplicable(tarifs, "2024-06-01")).toBe(600);
    expect(tarifApplicable(tarifs, "2025-03-01")).toBe(1100);
    expect(tarifApplicable(tarifs, "2026-09-11")).toBe(1100);
  });

  it("applique le plus ancien tarif avant sa date d'entree en vigueur", () => {
    // Plutot que zero: une reprise de donnees incomplete ne doit pas faire
    // disparaitre des paiements du cumul.
    expect(tarifApplicable(tarifs, "2023-01-01")).toBe(600);
  });

  it("ne depend pas de l'ordre de la liste", () => {
    expect(tarifApplicable([...tarifs].reverse(), "2024-06-01")).toBe(600);
  });
});

describe("totalPaye", () => {
  it("additionne chaque annee au tarif qui s'appliquait", () => {
    // Le cas de l'enonce: nom de domaine a 6 EUR la premiere annee, puis 11 EUR
    const tarifs = [
      { debut: "2024-03-01", montant_cents: 600 },
      { debut: "2025-03-01", montant_cents: 1100 },
    ];
    const total = totalPaye(
      { debut: "2024-03-01", periodicite: "annuel" },
      tarifs,
      "2026-09-11",
    );
    // 2024: 6,00 + 2025: 11,00 + 2026: 11,00 = 28,00 EUR
    expect(total).toBe(2800);
  });

  it("ne compte pas une hausse comme retroactive", () => {
    const tarifs = [
      { debut: "2026-01-01", montant_cents: 500 },
      { debut: "2026-03-01", montant_cents: 900 },
    ];
    const total = totalPaye({ debut: "2026-01-01", periodicite: "mensuel" }, tarifs, "2026-04-15");
    // jan 5 + fev 5 + mars 9 + avril 9 = 28,00 EUR
    expect(total).toBe(2800);
  });

  it("renvoie zero sans tarif connu", () => {
    expect(totalPaye({ debut: "2024-01-01", periodicite: "mensuel" }, [], "2026-01-01")).toBe(0);
  });
});

describe("coutMensuelEquivalent", () => {
  it("laisse un mensuel tel quel", () => {
    expect(coutMensuelEquivalent({ montant_cents: 599, periodicite: "mensuel" })).toBe(599);
  });

  it("divise un annuel par douze", () => {
    expect(coutMensuelEquivalent({ montant_cents: 1200, periodicite: "annuel" })).toBe(100);
  });
});

describe("prochaineEcheance", () => {
  it("suit le rythme de l'abonnement", () => {
    expect(prochaineEcheance("2026-07-10", "mensuel", "2026-09-15")).toBe("2026-10-10");
    expect(prochaineEcheance("2024-03-01", "annuel", "2026-09-11")).toBe("2027-03-01");
  });

  it("renvoie le debut quand aucun paiement n'a encore eu lieu", () => {
    expect(prochaineEcheance("2027-01-01", "mensuel", "2026-09-11")).toBe("2027-01-01");
  });
});
