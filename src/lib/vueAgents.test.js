import { describe, expect, it } from "vitest";
import { RAPPORTS_MAX, aFaire, dureeRapport, frise, libelleNiveau, niveauTache, resumeSite, statutSite, vueParSite } from "./vueAgents";

const MAINTENANT = new Date(2026, 9, 26, 12, 0);
const rapport = (site, date, agent, statut, extra = {}) => ({
  cle: `${site}/${date}/${agent}`,
  site,
  date,
  agent,
  titre: extra.titre ?? agent,
  statut,
  resume: extra.resume ?? "",
  points: extra.points ?? [],
  debut: extra.debut ?? null,
  fin: extra.fin ?? null,
});

describe("niveau du jour d'une tache", () => {
  it("rapport en echec, bloquee ou pas lancee : action", () => {
    expect(niveauTache({ rapportDuJour: { statut: "echec" } })).toBe("action");
    expect(niveauTache({ attendu: { situation: "bloque" } })).toBe("action");
    expect(niveauTache({ attendu: { situation: "non_lance" } })).toBe("action");
  });

  it("le rapport l'emporte sur la situation, et sinon en cours, prevue ou rien", () => {
    expect(niveauTache({ attendu: { situation: "recu", rapport: { statut: "attention" } } })).toBe("attention");
    expect(niveauTache({ rapportDuJour: { statut: "ok" } })).toBe("ok");
    expect(niveauTache({ attendu: { situation: "en_cours" } })).toBe("en_cours");
    expect(niveauTache({ attendu: { situation: "prevu" } })).toBe("prevu");
    expect(niveauTache({})).toBe("aucun");
  });
});

describe("statut et resume d'un site", () => {
  it("prend le pire des taches du jour ; en cours ou prevue ne comptent pas", () => {
    expect(statutSite([{ niveau: "ok" }, { niveau: "attention" }])).toBe("attention");
    expect(statutSite([{ niveau: "ok" }, { niveau: "action" }, { niveau: "attention" }])).toBe("action");
    expect(statutSite([{ niveau: "prevu" }, { niveau: "en_cours" }])).toBe("aucun");
    expect(statutSite([])).toBe("aucun");
  });

  it("resume : la tache qui va mal d'abord, puis le compte des autres", () => {
    const taches = [
      { titre: "Santé", niveau: "ok" },
      { titre: "Indexation Google", niveau: "action", rapportDuJour: { resume: "Chrome déconnecté. Rien n'a été soumis." } },
      { titre: "Bing", niveau: "ok" },
    ];
    expect(resumeSite(taches)).toBe("Indexation Google : Chrome déconnecté. 2 autre(s) OK.");
  });

  it("au plus deux taches detaillees, les autres comptees", () => {
    const taches = ["A", "B", "C"].map((t) => ({ titre: t, niveau: "attention", rapportDuJour: { resume: `${t} à voir` } }));
    expect(resumeSite(taches)).toBe("A : A à voir. B : B à voir. 1 autre(s) tâche(s) à regarder.");
  });

  it("tout va bien, ou rien encore aujourd'hui", () => {
    expect(resumeSite([{ titre: "Santé", niveau: "ok" }])).toBe("La tâche du jour est OK.");
    expect(resumeSite([{ titre: "Santé", niveau: "ok" }, { titre: "Bing", niveau: "ok" }])).toBe("Les 2 tâches du jour sont OK.");
    expect(resumeSite([{ titre: "Indexation", niveau: "prevu", attendu: { prevueA: "09:00" } }])).toBe(
      "Rien encore aujourd'hui : indexation prévue à 09:00.",
    );
    expect(resumeSite([{ titre: "Indexation", niveau: "en_cours" }])).toBe("Indexation en cours.");
    expect(resumeSite([])).toBe("Aucune tâche aujourd'hui.");
  });

  it("une premiere phrase trop longue est coupee", () => {
    const long = "x".repeat(300);
    expect(resumeSite([{ titre: "T", niveau: "attention", rapportDuJour: { resume: long } }]).length).toBeLessThan(160);
  });
});

describe("a faire", () => {
  it("les points non ok du jour, les echecs d'abord, sans doublon", () => {
    const taches = [
      {
        id: "seo",
        titre: "SEO",
        rapportDuJour: {
          statut: "attention",
          points: [
            { niveau: "ok", texte: "RAS" },
            { niveau: "attention", texte: "Une page en 404" },
          ],
        },
      },
      {
        id: "indexation",
        titre: "Indexation",
        rapportDuJour: {
          statut: "echec",
          points: [
            { niveau: "echec", texte: "Reconnecter Chrome" },
            { niveau: "attention", texte: "une page en 404" },
          ],
        },
      },
    ];
    expect(aFaire(taches).map((a) => [a.niveau, a.texte, a.tache])).toEqual([
      ["echec", "Reconnecter Chrome", "Indexation"],
      ["attention", "Une page en 404", "SEO"],
    ]);
  });

  it("une tache bloquee ou pas lancee, et un echec sans point qui le dise", () => {
    const taches = [
      { id: "a", titre: "A", attendu: { situation: "non_lance", message: "Prévu à 09:00, pas encore lancé" } },
      { id: "b", titre: "B", rapportDuJour: { statut: "echec", resume: "Plantage", points: [] } },
      { id: "c", titre: "C", attendu: { situation: "en_cours", message: "Lancé à 10:00" } },
    ];
    expect(aFaire(taches).map((a) => a.texte)).toEqual(["Prévu à 09:00, pas encore lancé", "Plantage"]);
  });

  it("garde la premiere phrase pour la liste, le texte entier a cote", () => {
    const texte = "Extension non connectée : rien n'a été fait. Dans Chrome, clique sur l'icône Claude.";
    const [item] = aFaire([{ id: "a", titre: "A", rapportDuJour: { statut: "echec", points: [{ niveau: "echec", texte }] } }]);
    expect(item.court).toBe("Extension non connectée : rien n'a été fait.");
    expect(item.texte).toBe(texte);
  });
});

describe("frise des derniers passages", () => {
  // Du plus recent au plus ancien, comme vueParSite les trie
  const passages = [
    rapport("d.fr", "2026-10-26", "x", "ok", { debut: "2026-10-26T12:30:00+01:00" }),
    rapport("d.fr", "2026-10-26", "x", "echec", { debut: "2026-10-26T09:15:00+01:00" }),
    rapport("d.fr", "2026-10-24", "x", "attention"),
  ];

  it("un carre par passage, pas par jour : du plus ancien au plus recent, cases vides a gauche", () => {
    expect(frise(passages, { places: 4 }).map((p) => p?.statut ?? null)).toEqual([null, "attention", "echec", "ok"]);
    expect(frise(passages, { places: 4 })[3]).toMatchObject({ date: "2026-10-26", debut: "2026-10-26T12:30:00+01:00" });
  });

  it("sept relances dans la journee remplissent la frise", () => {
    const sept = Array.from({ length: 9 }, (_, i) => rapport("d.fr", "2026-10-26", `x@${i}`, i === 0 ? "ok" : "echec"));
    const carres = frise(sept);
    expect(carres).toHaveLength(7);
    expect(carres.every((p) => p?.date === "2026-10-26")).toBe(true);
    expect(carres.at(-1).statut).toBe("ok");
  });

  it("la tache qui tourne ajoute un carre bleu a droite et pousse le plus ancien", () => {
    const carres = frise(passages, { enCours: true, places: 3 });
    expect(carres.map((p) => (p?.enCours ? "bleu" : p?.statut))).toEqual(["echec", "ok", "bleu"]);
  });
});

describe("vue par site", () => {
  const controles = [
    { id: "indexation-d", site: "denivio.fr", titre: "Indexation Google", cron: "0 9 * * *" },
    { id: "correctifs-d", site: "denivio.fr", titre: "Correctifs", cron: null },
    { id: "sante-r", site: "roisempereurs.fr", titre: "Santé", cron: "45 7 * * *" },
  ];
  const rapports = [
    rapport("denivio.fr", "2026-10-26", "indexation-d", "echec", { titre: "Indexation Google", resume: "Chrome déconnecté." }),
    rapport("denivio.fr", "2026-10-25", "indexation-d", "ok", { titre: "Indexation Google" }),
    rapport("roisempereurs.fr", "2026-10-26", "sante-r", "ok", { titre: "Santé" }),
    // Un ancien agent, plus au registre : il garde son historique
    rapport("denivio.fr", "2026-10-20", "ancien", "ok", { titre: "Ancien agent" }),
  ];
  const sites = [{ nom: "Denivio", url: "https://www.denivio.fr", couleur: "#0f0" }];

  it("regroupe par site, le site qui demande une action d'abord", () => {
    const vues = vueParSite({ rapports, controles, sites, aujourdhui: MAINTENANT });
    expect(vues.map((v) => [v.cle, v.nom, v.statut])).toEqual([
      ["denivio.fr", "Denivio", "action"],
      ["roisempereurs.fr", "roisempereurs.fr", "ok"],
    ]);
    expect(vues[0].couleur).toBe("#0f0");
  });

  it("les taches d'un site : registre, rapports et anciens agents ; la pire en tete", () => {
    const [denivio] = vueParSite({ rapports, controles, sites, aujourdhui: MAINTENANT });
    expect(denivio.taches.map((t) => [t.titre, t.niveau])).toEqual([
      ["Indexation Google", "action"],
      ["Ancien agent", "aucun"],
      ["Correctifs", "aucun"],
    ]);
    const indexation = denivio.taches[0];
    expect(indexation.planning).toBe("tous les jours à 09:00");
    expect(indexation.rapports.map((r) => r.date)).toEqual(["2026-10-26", "2026-10-25"]);
    expect(indexation.frise.at(-1)).toMatchObject({ date: "2026-10-26", statut: "echec" });
    expect(indexation.frise.at(-2)).toMatchObject({ date: "2026-10-25", statut: "ok" });
    expect(indexation.frise.at(-3)).toBeNull();
    expect(denivio.taches.find((t) => t.id === "correctifs-d").planning).toBe("à la demande");
    expect(denivio.resume).toBe("Indexation Google : Chrome déconnecté.");
  });

  it("une tache attendue sans rapport (bloquee) rend le site en action", () => {
    const attendus = [{ id: "sante-r", agent: "sante-r", site: "roisempereurs.fr", titre: "Santé", situation: "bloque", message: "Bloquée", rapport: null }];
    const vues = vueParSite({ attendus, controles: controles.slice(2), aujourdhui: MAINTENANT });
    expect(vues[0]).toMatchObject({ cle: "roisempereurs.fr", statut: "action" });
    expect(vues[0].aFaire.map((a) => a.texte)).toEqual(["Bloquée"]);
  });

  it("une relance qui corrige un probleme l'efface de « À faire », meme si le planning gardait l'ancien rapport", () => {
    const matin = rapport("denivio.fr", "2026-10-26", "indexation-d", "attention", {
      debut: "2026-10-26T09:00:00+01:00",
      points: [{ niveau: "attention", texte: "Bing déconnecté" }],
    });
    const soir = rapport("denivio.fr", "2026-10-26", "indexation-d", "ok", { debut: "2026-10-26T18:00:00+01:00" });
    soir.cle = "denivio.fr/2026-10-26/indexation-d@relance";
    const attendus = [{ id: "indexation-d", agent: "indexation-d", site: "denivio.fr", titre: "Indexation Google", situation: "recu", rapport: matin }];
    const [denivio] = vueParSite({ rapports: [matin, soir], attendus, controles, aujourdhui: MAINTENANT });
    expect(denivio.aFaire).toEqual([]);
    expect(denivio.taches.find((t) => t.id === "indexation-d").niveau).toBe("ok");
  });

  it("rien du tout : aucune carte", () => {
    expect(vueParSite({ aujourdhui: MAINTENANT })).toEqual([]);
  });

  it("une tache qui tourne : en cours, un carre bleu en plus a droite, le niveau du rapport precedent reste", () => {
    const [denivio] = vueParSite({ rapports, controles, sites, enCours: ["indexation-d", "correctifs-d"], aujourdhui: MAINTENANT });
    const indexation = denivio.taches.find((t) => t.id === "indexation-d");
    expect(indexation).toMatchObject({ enCours: true, niveau: "action" });
    expect(libelleNiveau(indexation)).toBe("En cours");
    expect(indexation.frise.at(-1)).toEqual({ enCours: true });
    expect(indexation.frise.at(-2)).toMatchObject({ date: "2026-10-26", statut: "echec" });
    // Sans rapport du jour, la tache qui tourne est en cours
    expect(denivio.taches.find((t) => t.id === "correctifs-d").niveau).toBe("en_cours");
  });

  it(`garde au plus ${RAPPORTS_MAX} rapports, les plus recents`, () => {
    const beaucoup = Array.from({ length: 10 }, (_, i) =>
      rapport("denivio.fr", `2026-10-${String(17 + i).padStart(2, "0")}`, "indexation-d", "ok"),
    );
    const [denivio] = vueParSite({ rapports: beaucoup, controles, aujourdhui: MAINTENANT });
    const dates = denivio.taches.find((t) => t.id === "indexation-d").rapports.map((r) => r.date);
    expect(dates).toHaveLength(RAPPORTS_MAX);
    expect(dates[0]).toBe("2026-10-26");
    expect(dates.at(-1)).toBe("2026-10-20");
  });
});

describe("duree d'un passage", () => {
  it("secondes, minutes, heures", () => {
    expect(dureeRapport("2026-10-26T09:00:00+01:00", "2026-10-26T09:00:45+01:00")).toBe("45 s");
    expect(dureeRapport("2026-10-26T09:00:00+01:00", "2026-10-26T09:12:20+01:00")).toBe("12 min");
    expect(dureeRapport("2026-10-26T09:00:00+01:00", "2026-10-26T10:05:00+01:00")).toBe("1 h 05");
  });

  it("rien sans debut ou fin lisibles", () => {
    expect(dureeRapport(null, "2026-10-26T09:00:00+01:00")).toBeNull();
    expect(dureeRapport("2026-10-26T09:00:00+01:00", undefined)).toBeNull();
  });
});
