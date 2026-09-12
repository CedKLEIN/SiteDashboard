import { describe, expect, it } from "vitest";
import {
  abonnementsParMois,
  abonnementsParSite,
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

describe("abonnementsParMois", () => {
  // Cas reel: un VPS mensuel paye depuis juillet 2025, invisible jusqu'ici dans
  // le graphe des depenses parce qu'il ne vit pas dans la table depenses.
  const vps = { id: 1, debut: "2025-07-29", periodicite: "mensuel", fin: null };
  const tarifs = [{ abonnement_id: 1, debut: "2025-07-29", montant_cents: 1080 }];

  it("etale l'abonnement sur chaque mois paye", () => {
    // Prelevement le 29: au 15 octobre, l'echeance d'octobre n'a pas encore eu
    // lieu. Compter le mois en cours d'office gonflerait le total d'un mois.
    const parMois = abonnementsParMois([vps], tarifs, "2025-10-15");
    expect([...parMois.keys()]).toEqual(["2025-07", "2025-08", "2025-09"]);
    expect(parMois.get("2025-09")).toBe(1080);
  });

  it("compte le mois en cours une fois la date de prelevement passee", () => {
    const parMois = abonnementsParMois([vps], tarifs, "2025-10-30");
    expect([...parMois.keys()]).toEqual(["2025-07", "2025-08", "2025-09", "2025-10"]);
  });

  it("applique le tarif en vigueur a chaque mois", () => {
    const avecHausse = [
      { abonnement_id: 1, debut: "2025-07-29", montant_cents: 1080 },
      { abonnement_id: 1, debut: "2025-09-01", montant_cents: 1500 },
    ];
    const parMois = abonnementsParMois([vps], avecHausse, "2025-09-30");
    expect(parMois.get("2025-08")).toBe(1080);
    expect(parMois.get("2025-09")).toBe(1500);
  });

  it("s'arrete a la date de resiliation, sans inventer de prelevement", () => {
    const resilie = { ...vps, fin: "2025-09-01" };
    const parMois = abonnementsParMois([resilie], tarifs, "2026-09-11");
    expect([...parMois.keys()]).toEqual(["2025-07", "2025-08"]);
  });

  it("conserve les paiements passes d'un abonnement resilie", () => {
    const resilie = { ...vps, fin: "2025-09-01" };
    const total = [...abonnementsParMois([resilie], tarifs, "2026-09-11").values()].reduce(
      (t, v) => t + v,
      0,
    );
    expect(total).toBe(2160);
  });

  it("ignore un abonnement sans tarif connu", () => {
    expect(abonnementsParMois([vps], [], "2025-10-15").size).toBe(0);
  });
});

describe("abonnementsParSite", () => {
  const vps = { id: 1, debut: "2026-09-01", periodicite: "mensuel", fin: null };
  const tarifs = [{ abonnement_id: 1, debut: "2026-09-01", montant_cents: 1080 }];
  const parts = [
    { abonnement_id: 1, site_id: 7, part_cents: 540 },
    { abonnement_id: 1, site_id: 9, part_cents: 540 },
  ];

  it("impute a chaque site sa fraction, pas le montant entier", () => {
    const parSite = abonnementsParSite([vps], tarifs, parts, "2026-09-01", "2026-09-30");
    expect(parSite.get(7)).toBe(540);
    expect(parSite.get(9)).toBe(540);
  });

  it("ne compte rien hors de la periode demandee", () => {
    // L'echeance d'octobre tombe le 1er: une periode qui demarre le 2 l'exclut
    const parSite = abonnementsParSite([vps], tarifs, parts, "2026-10-02", "2026-10-31");
    expect(parSite.size).toBe(0);
  });

  it("compte l'echeance du mois suivant quand elle est dans la periode", () => {
    const parSite = abonnementsParSite([vps], tarifs, parts, "2026-10-01", "2026-10-31");
    expect(parSite.get(7)).toBe(540);
  });

  it("respecte un partage inegal", () => {
    const inegal = [
      { abonnement_id: 1, site_id: 7, part_cents: 864 },
      { abonnement_id: 1, site_id: 9, part_cents: 216 },
    ];
    const parSite = abonnementsParSite([vps], tarifs, inegal, "2026-09-01", "2026-09-30");
    expect(parSite.get(7)).toBe(864);
    expect(parSite.get(9)).toBe(216);
  });

  it("n'impute rien pour un abonnement transverse", () => {
    expect(abonnementsParSite([vps], tarifs, [], "2026-09-01", "2026-09-30").size).toBe(0);
  });
});

describe("abonnementsParMois filtre par site", () => {
  const vps = { id: 1, debut: "2026-09-01", periodicite: "mensuel", fin: null };
  const tarifs = [{ abonnement_id: 1, debut: "2026-09-01", montant_cents: 1080 }];
  const parts = [
    { abonnement_id: 1, site_id: 7, part_cents: 540 },
    { abonnement_id: 1, site_id: 9, part_cents: 540 },
  ];

  it("ne compte que la part du site demande", () => {
    const parMois = abonnementsParMois([vps], tarifs, "2026-09-30", { parts, siteId: 7 });
    expect(parMois.get("2026-09")).toBe(540);
  });

  it("compte le montant entier sans filtre de site", () => {
    const parMois = abonnementsParMois([vps], tarifs, "2026-09-30");
    expect(parMois.get("2026-09")).toBe(1080);
  });

  it("ignore un abonnement auquel le site n'est pas rattache", () => {
    const parMois = abonnementsParMois([vps], tarifs, "2026-09-30", { parts, siteId: 42 });
    expect(parMois.size).toBe(0);
  });

  it("respecte un partage inegal", () => {
    const inegal = [
      { abonnement_id: 1, site_id: 7, part_cents: 864 },
      { abonnement_id: 1, site_id: 9, part_cents: 216 },
    ];
    expect(
      abonnementsParMois([vps], tarifs, "2026-09-30", { parts: inegal, siteId: 9 }).get("2026-09"),
    ).toBe(216);
  });

  it("la somme des parts par site fait le montant total", () => {
    const pour7 = abonnementsParMois([vps], tarifs, "2026-09-30", { parts, siteId: 7 });
    const pour9 = abonnementsParMois([vps], tarifs, "2026-09-30", { parts, siteId: 9 });
    expect(pour7.get("2026-09") + pour9.get("2026-09")).toBe(1080);
  });
});

describe("arret d'un abonnement", () => {
  const tarifs = [{ debut: "2025-01-01", montant_cents: 1000 }];

  it("cesse de cumuler apres la date d'arret", () => {
    const arrete = { debut: "2025-01-01", periodicite: "mensuel", fin: "2025-04-01" };
    // Janvier, fevrier, mars: trois echeances avant l'arret du 1er avril
    expect(totalPaye(arrete, tarifs, "2026-09-12")).toBe(3000);
  });

  it("conserve integralement ce qui a ete paye avant l'arret", () => {
    const arrete = { debut: "2025-01-01", periodicite: "mensuel", fin: "2025-04-01" };
    const encoreActif = { debut: "2025-01-01", periodicite: "mensuel", fin: null };

    // Arreter ne doit rien effacer du passe, seulement stopper l'accumulation
    expect(totalPaye(arrete, tarifs, "2025-03-15")).toBe(
      totalPaye(encoreActif, tarifs, "2025-03-15"),
    );
  });

  it("continue de cumuler tant qu'il n'est pas arrete", () => {
    const actif = { debut: "2025-01-01", periodicite: "mensuel", fin: null };
    expect(totalPaye(actif, tarifs, "2025-06-01")).toBe(6000);
  });

  it("ignore une date de fin posterieure a aujourd'hui", () => {
    // Un arret programme dans le futur ne doit pas amputer le present
    const futur = { debut: "2025-01-01", periodicite: "mensuel", fin: "2030-01-01" };
    expect(totalPaye(futur, tarifs, "2025-06-01")).toBe(6000);
  });

  it("applique le tarif de chaque echeance jusqu'a l'arret", () => {
    const avecHausse = [
      { debut: "2025-01-01", montant_cents: 1000 },
      { debut: "2025-03-01", montant_cents: 1500 },
    ];
    const arrete = { debut: "2025-01-01", periodicite: "mensuel", fin: "2025-04-01" };
    // jan 10 + fev 10 + mars 15 = 35,00 EUR
    expect(totalPaye(arrete, avecHausse, "2026-09-12")).toBe(3500);
  });
});
