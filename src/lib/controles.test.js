import { describe, expect, it } from "vitest";
import {
  ajouterSuites,
  appliquerReglages,
  commeTachesPlanifiees,
  composerCron,
  controlesDus,
  decomposerCron,
  dernierPassagePrevu,
  enregistrerNouvelles,
  file,
  fusionnerTaches,
  horaireLisible,
  planifierReessai,
  reessaisDus,
  separerAjouts,
} from "./controles";
import { agentsAttendus, nbAgentsEnRetard } from "./tachesPlanifiees";

describe("reglages des taches", () => {
  const registre = [
    { id: "sante", cron: "30 7 * * *" },
    { id: "seo", cron: "5 9 * * *", type: "claude" },
  ];

  it("applique l'horaire modifie et la desactivation, en gardant l'horaire par defaut", () => {
    const [sante, seo] = appliquerReglages(registre, { horaires: { sante: "0 6 * * 1-5" }, desactives: ["seo"] });
    expect(sante).toMatchObject({ cron: "0 6 * * 1-5", cronParDefaut: "30 7 * * *", actif: true });
    expect(seo).toMatchObject({ cron: "5 9 * * *", actif: false });
    expect(controlesDus([sante, seo], {}, new Date(2026, 9, 26, 12, 0)).map((c) => c.id)).toEqual(["sante"]);
  });

  it("enregistre une tache nouvelle comme ajoutee, sans la rattraper ni la dire lancee", () => {
    const maintenant = new Date(2026, 9, 25, 19, 0);
    const derniers = { sante: new Date(2026, 9, 25, 7, 31).toISOString() };
    const ajouts = enregistrerNouvelles(registre, derniers, {}, maintenant);
    // L'ajout va dans `ajouts` : les derniers lancements ne bougent pas
    expect(ajouts).toEqual({ seo: maintenant.toISOString() });
    // Le SEO de 9 h 05 est deja passe aujourd'hui : il n'est pas du avant demain
    expect(controlesDus(appliquerReglages(registre), derniers, maintenant, ajouts)).toEqual([]);
    expect(controlesDus(appliquerReglages(registre), derniers, new Date(2026, 9, 26, 9, 10), ajouts).map((c) => c.id)).toEqual(["sante", "seo"]);
    expect(enregistrerNouvelles(registre, derniers, ajouts, maintenant)).toBeNull();
  });

  it("n'attend pas aujourd'hui une tache ajoutee apres son heure", () => {
    const maintenant = new Date(2026, 9, 25, 19, 30);
    const ajoutee = new Date(2026, 9, 25, 19, 28).toISOString();
    const taches = commeTachesPlanifiees([{ id: "seo", site: "x.fr", titre: "SEO", cron: "5 9 * * *" }], {}, { seo: ajoutee });
    expect(taches.scheduledTasks[0]).toMatchObject({ lastRunAt: null, createdAt: new Date(ajoutee).getTime() });
    const attendus = agentsAttendus({ taches: taches.taches, config: JSON.stringify(taches), rapports: [], maintenant });
    expect(attendus).toEqual([]);
    expect(nbAgentsEnRetard(attendus)).toBe(0);
  });

  it("separe les ajouts d'installation (meme instant) des vrais lancements", () => {
    const installation = "2026-10-25T18:28:26.497Z";
    const derniers = {
      "idees-a": installation,
      "idees-b": installation,
      sante: "2026-10-25T06:30:02.110Z",
      bing: "2026-10-25T08:00:41.903Z",
    };
    expect(separerAjouts(derniers)).toEqual({
      derniers: { sante: "2026-10-25T06:30:02.110Z", bing: "2026-10-25T08:00:41.903Z" },
      ajouts: { "idees-a": installation, "idees-b": installation },
    });
    expect(separerAjouts({})).toEqual({ derniers: {}, ajouts: {} });
  });

  it("ne compte plus comme bloque un agent hebdomadaire seulement ajoute aujourd'hui", () => {
    // Le cas du badge « 2 » : Idees (samedi) enregistrees dimanche a 19 h 28
    const maintenant = new Date(2026, 9, 25, 22, 0);
    const installation = new Date(2026, 9, 25, 19, 28).toISOString();
    const controles = [
      { id: "idees-a", site: "a.fr", titre: "Idées", cron: "0 10 * * 6" },
      { id: "idees-b", site: "b.fr", titre: "Idées", cron: "30 10 * * 6" },
    ];
    const avant = commeTachesPlanifiees(controles, { "idees-a": installation, "idees-b": installation });
    expect(nbAgentsEnRetard(agentsAttendus({ taches: avant.taches, config: JSON.stringify(avant), maintenant }))).toBe(2);
    const { derniers, ajouts } = separerAjouts({ "idees-a": installation, "idees-b": installation });
    const apres = commeTachesPlanifiees(controles, derniers, ajouts);
    expect(nbAgentsEnRetard(agentsAttendus({ taches: apres.taches, config: JSON.stringify(apres), maintenant }))).toBe(0);
  });

  it("range les agents Claude dans leur propre file", () => {
    expect(registre.map(file)).toEqual(["script", "claude"]);
  });

  it("compose et decompose un horaire", () => {
    expect(decomposerCron("5 9 * * 1-5")).toEqual({ heure: "09:05", jours: "1-5" });
    expect(composerCron("07:30", "6")).toBe("30 7 * * 6");
    expect(composerCron("25:00", "*")).toBeNull();
    expect(horaireLisible("0 6 * * 1-5")).toBe("du lundi au vendredi à 06:00");
    expect(horaireLisible("0 10 * * 0,6")).toBe("le week-end à 10:00");
  });
});

// Dimanche 25 octobre 2026, 18 h (heure locale)
const MAINTENANT = new Date(2026, 9, 25, 18, 0);
const QUOTIDIEN = { id: "sante", site: "x.fr", titre: "Santé", cron: "30 7 * * *" };
const LUNDI = { id: "audit", site: "x.fr", titre: "Audit", cron: "0 7 * * 1" };

describe("dernierPassagePrevu", () => {
  it("trouve le passage du jour s'il est passe, sinon celui de la veille", () => {
    expect(dernierPassagePrevu(QUOTIDIEN.cron, MAINTENANT)).toEqual(new Date(2026, 9, 25, 7, 30));
    expect(dernierPassagePrevu(QUOTIDIEN.cron, new Date(2026, 9, 25, 6, 0))).toEqual(new Date(2026, 9, 24, 7, 30));
  });

  it("remonte jusqu'au dernier lundi pour un controle hebdomadaire", () => {
    expect(dernierPassagePrevu(LUNDI.cron, MAINTENANT)).toEqual(new Date(2026, 9, 19, 7, 0));
  });
});

describe("rattrapage des passages manques", () => {
  const QUOTIDIEN_9H = { id: "seo", cron: "0 9 * * *" };
  const HEBDO_LUNDI = { id: "audit", cron: "0 7 * * 1" };
  const SAMEDI = { id: "idees", cron: "0 10 * * 6" };
  const ids = (liste) => liste.map((c) => c.id);
  // Lundi 26 octobre 2026
  const lundi = (h, m = 0) => new Date(2026, 9, 26, h, m);

  it("allume a 10 h : la tache de 9 h est lancee une fois", () => {
    const derniers = { seo: new Date(2026, 9, 25, 9, 2).toISOString() };
    expect(ids(controlesDus([QUOTIDIEN_9H], derniers, lundi(10)))).toEqual(["seo"]);
    // Une fois lancee a 10 h, elle n'est plus due de la journee
    const apres = { seo: lundi(10, 1).toISOString() };
    expect(controlesDus([QUOTIDIEN_9H], apres, lundi(10, 2))).toEqual([]);
    expect(controlesDus([QUOTIDIEN_9H], apres, lundi(23, 59))).toEqual([]);
    // Et redevient due le lendemain a 9 h, pas avant
    expect(controlesDus([QUOTIDIEN_9H], apres, new Date(2026, 9, 27, 8, 59))).toEqual([]);
    expect(ids(controlesDus([QUOTIDIEN_9H], apres, new Date(2026, 9, 27, 9, 0)))).toEqual(["seo"]);
  });

  it("allume avant l'heure : rien a rattraper, la tache attend son horaire", () => {
    const derniers = { seo: new Date(2026, 9, 25, 9, 2).toISOString() };
    expect(controlesDus([QUOTIDIEN_9H], derniers, lundi(8, 30))).toEqual([]);
  });

  it("une semaine eteint : un seul passage par tache, pas sept", () => {
    const ilYaUneSemaine = new Date(2026, 9, 19, 9, 1).toISOString();
    const derniers = { seo: ilYaUneSemaine, audit: new Date(2026, 9, 19, 7, 1).toISOString(), idees: new Date(2026, 9, 17, 10, 5).toISOString() };
    const dus = controlesDus([QUOTIDIEN_9H, HEBDO_LUNDI, SAMEDI], derniers, lundi(10));
    expect(ids(dus)).toEqual(["seo", "audit", "idees"]);
    // Chacune lancee une fois : plus rien de du, quel que soit le retard
    const relances = Object.fromEntries(["seo", "audit", "idees"].map((id, i) => [id, lundi(10, i + 1).toISOString()]));
    expect(controlesDus([QUOTIDIEN_9H, HEBDO_LUNDI, SAMEDI], relances, lundi(10, 5))).toEqual([]);
  });

  it("trois semaines eteint : toujours un seul passage, meme pour une tache hebdomadaire", () => {
    const derniers = { seo: new Date(2026, 9, 5, 9).toISOString(), audit: new Date(2026, 9, 5, 7).toISOString() };
    expect(ids(controlesDus([QUOTIDIEN_9H, HEBDO_LUNDI], derniers, lundi(10)))).toEqual(["seo", "audit"]);
  });

  it("jamais lancee et sans date d'ajout : due a son dernier passage", () => {
    expect(ids(controlesDus([QUOTIDIEN_9H], {}, lundi(10)))).toEqual(["seo"]);
  });

  it("une date de lancement illisible ne bloque pas la tache", () => {
    expect(ids(controlesDus([QUOTIDIEN_9H], { seo: "n'importe quoi" }, lundi(10)))).toEqual(["seo"]);
  });

  it("une tache desactivee n'est jamais rattrapee", () => {
    expect(controlesDus([{ ...QUOTIDIEN_9H, actif: false }], {}, lundi(10))).toEqual([]);
  });

  it("un horaire modifie compte : passee de 9 h a 11 h, elle attend 11 h", () => {
    const derniers = { seo: new Date(2026, 9, 25, 11, 1).toISOString() };
    const [modifiee] = appliquerReglages([QUOTIDIEN_9H], { horaires: { seo: "0 11 * * *" } });
    expect(controlesDus([modifiee], derniers, lundi(10))).toEqual([]);
    expect(ids(controlesDus([modifiee], derniers, lundi(11)))).toEqual(["seo"]);
  });
});

describe("controlesDus", () => {
  it("rattrape un passage manque une seule fois", () => {
    expect(controlesDus([QUOTIDIEN, LUNDI], {}, MAINTENANT).map((c) => c.id)).toEqual(["sante", "audit"]);
    const derniers = { sante: new Date(2026, 9, 25, 9, 0).toISOString(), audit: new Date(2026, 9, 20, 8, 0).toISOString() };
    expect(controlesDus([QUOTIDIEN, LUNDI], derniers, MAINTENANT)).toEqual([]);
    // Lance hier : du a nouveau aujourd'hui
    expect(controlesDus([QUOTIDIEN], { sante: new Date(2026, 9, 24, 9, 0).toISOString() }, MAINTENANT)).toHaveLength(1);
  });
});

describe("horaireLisible", () => {
  it("dit l'horaire en francais", () => {
    expect(horaireLisible("30 7 * * *")).toBe("tous les jours à 07:30");
    expect(horaireLisible("0 7 * * 1")).toBe("le lundi à 07:00");
    expect(horaireLisible(null)).toBe("à la demande");
  });
});

describe("nouveaux essais d'un agent dont le travail n'a pas pu se faire", () => {
  const INDEXATION = { id: "indexation", cron: "0 9 * * *", type: "claude", chrome: true };
  const a = (h, m = 0) => new Date(2026, 9, 26, h, m);

  it("Chrome deconnecte a 9 h : nouvel essai a 9 h 30, pas avant", () => {
    const reessais = planifierReessai({}, "indexation", { statut: "echec", reessai: true }, a(9, 0));
    expect(reessais.indexation).toMatchObject({ essais: 1, prochain: a(9, 30).toISOString() });
    const controles = appliquerReglages([INDEXATION]);
    expect(reessaisDus(reessais, controles, a(9, 29))).toEqual([]);
    expect(reessaisDus(reessais, controles, a(9, 30))).toEqual(["indexation"]);
  });

  it("un passage reussi efface les essais en attente", () => {
    const reessais = planifierReessai({}, "indexation", { reessai: true }, a(9));
    expect(planifierReessai(reessais, "indexation", { statut: "ok" }, a(9, 31))).toEqual({});
  });

  it("au plus 8 essais dans la journee, puis on attend le lendemain", () => {
    let reessais = {};
    for (let i = 0; i < 8; i += 1) reessais = planifierReessai(reessais, "indexation", { reessai: true }, a(9 + i));
    expect(reessais.indexation.essais).toBe(8);
    expect(planifierReessai(reessais, "indexation", { reessai: true }, a(17))).toEqual({});
  });

  it("le compte repart a zero un autre jour, et un essai d'hier n'est pas relance", () => {
    const hier = planifierReessai({}, "indexation", { reessai: true }, new Date(2026, 9, 25, 23, 50));
    expect(reessaisDus(hier, appliquerReglages([INDEXATION]), a(9))).toEqual([]);
    expect(planifierReessai(hier, "indexation", { reessai: true }, a(9)).indexation.essais).toBe(1);
  });

  it("une tache desactivee n'est pas reessayee", () => {
    const reessais = planifierReessai({}, "indexation", { reessai: true }, a(9));
    const desactivee = appliquerReglages([INDEXATION], { desactives: ["indexation"] });
    expect(reessaisDus(reessais, desactivee, a(10))).toEqual([]);
  });

  it("ne touche pas aux essais des autres taches", () => {
    const reessais = planifierReessai({}, "seo", { reessai: true }, a(9));
    expect(Object.keys(planifierReessai(reessais, "indexation", { statut: "ok" }, a(9)))).toEqual(["seo"]);
  });
});

describe("badge Agents : un rapport en echec compte", () => {
  it("compte bloques, pas lances et rapports en echec, pas les rapports ok ou a regarder", () => {
    const attendus = [
      { situation: "bloque" },
      { situation: "non_lance" },
      { situation: "recu", rapport: { statut: "echec" } },
      { situation: "recu", rapport: { statut: "attention" } },
      { situation: "recu", rapport: { statut: "ok" } },
      { situation: "prevu" },
    ];
    expect(nbAgentsEnRetard(attendus)).toBe(3);
  });
});

describe("taches sans horaire (correctifs de dependances)", () => {
  const AUDIT = { id: "audit-a", site: "a.fr", titre: "Audit", cron: "0 7 * * 1" };
  const CORRECTIF = { id: "correctifs-a", site: "a.fr", titre: "Correctifs", cron: null, declenchePar: "audit-hebdo" };
  const AUTRE = { id: "correctifs-b", site: "b.fr", titre: "Correctifs", cron: null, declenchePar: "audit-hebdo" };

  it("n'est jamais due par l'horaire, meme jamais lancee ou apres des semaines", () => {
    const [correctif] = appliquerReglages([CORRECTIF]);
    expect(correctif).toMatchObject({ cron: null, cronParDefaut: null, actif: true });
    expect(dernierPassagePrevu(null, MAINTENANT)).toBeNull();
    expect(controlesDus([correctif], {}, MAINTENANT)).toEqual([]);
    expect(controlesDus([correctif], { "correctifs-a": "2026-01-01T00:00:00Z" }, MAINTENANT)).toEqual([]);
  });

  it("n'est pas attendue dans « Attendus aujourd'hui » et ne fait pas monter le badge", () => {
    const taches = commeTachesPlanifiees([AUDIT, CORRECTIF], {}, {});
    const attendus = agentsAttendus({ taches: taches.taches, config: JSON.stringify(taches), rapports: [], maintenant: new Date(2026, 9, 26, 12, 0) });
    expect(attendus.map((a) => a.agent)).not.toContain("correctifs-a");
    expect(nbAgentsEnRetard(attendus)).toBe(1); // l'audit du lundi, pas le correctif
  });

  it("l'audit la demande : elle part, une seule fois, si elle est active", () => {
    const controles = appliquerReglages([AUDIT, CORRECTIF, AUTRE]);
    expect(ajouterSuites([], ["correctifs-a"], controles)).toEqual(["correctifs-a"]);
    // Deja en attente : pas de doublon
    expect(ajouterSuites(["correctifs-a"], ["correctifs-a"], controles)).toEqual(["correctifs-a"]);
    expect(ajouterSuites(["correctifs-b"], ["correctifs-a"], controles)).toEqual(["correctifs-b", "correctifs-a"]);
  });

  it("decochee : plus de declenchement automatique (le lancement a la main reste)", () => {
    const controles = appliquerReglages([AUDIT, CORRECTIF], { desactives: ["correctifs-a"] });
    expect(ajouterSuites([], ["correctifs-a"], controles)).toEqual([]);
  });

  it("rien demande, ou une tache inconnue : la file ne change pas", () => {
    const controles = appliquerReglages([CORRECTIF]);
    expect(ajouterSuites([], undefined, controles)).toEqual([]);
    expect(ajouterSuites([], ["supprimee"], controles)).toEqual([]);
  });
});

describe("fusionnerTaches", () => {
  it("ajoute les controles aux taches de Claude et remplace l'ancien agent de meme id", () => {
    const claude = {
      taches: [{ id: "sante", skill: "ancien agent" }, { id: "seo", skill: "agent SEO" }],
      config: JSON.stringify({ scheduledTasks: [{ id: "sante", cronExpression: "30 7 * * *" }, { id: "seo", cronExpression: "0 9 * * *" }] }),
    };
    const fusion = fusionnerTaches(claude, [QUOTIDIEN], { sante: "2026-10-25T08:00:00.000Z" });
    expect(fusion.taches.map((t) => t.id)).toEqual(["seo", "sante"]);
    expect(fusion.taches[1].skill).toContain("rapports-agents\\x.fr\\<AAAA-MM-JJ>\\sante.json");
    const config = JSON.parse(fusion.config).scheduledTasks;
    expect(config.map((t) => t.id)).toEqual(["seo", "sante"]);
    expect(config[1]).toMatchObject({ enabled: true, lastRunAt: "2026-10-25T08:00:00.000Z" });
  });

  it("garde les controles attendus sans config de Claude", () => {
    expect(JSON.parse(fusionnerTaches({ taches: [], config: null }, [QUOTIDIEN], {}).config).scheduledTasks).toHaveLength(1);
  });
});
