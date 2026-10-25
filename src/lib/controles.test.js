import { describe, expect, it } from "vitest";
import {
  appliquerReglages,
  composerCron,
  controlesDus,
  decomposerCron,
  dernierPassagePrevu,
  enregistrerNouvelles,
  file,
  fusionnerTaches,
  horaireLisible,
  REGISTRE,
} from "./controles";

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

  it("enregistre une tache nouvelle sans la rattraper", () => {
    const maintenant = new Date(2026, 9, 25, 19, 0);
    const derniers = enregistrerNouvelles(registre, { sante: "2026-10-25T06:30:00.000Z" }, maintenant);
    expect(derniers).toEqual({ sante: "2026-10-25T06:30:00.000Z", seo: maintenant.toISOString() });
    // Le SEO de 9 h 05 est deja passe aujourd'hui : il n'est pas du avant demain
    expect(controlesDus(appliquerReglages(registre), derniers, maintenant)).toEqual([]);
    expect(enregistrerNouvelles(registre, derniers, maintenant)).toBeNull();
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

  it("charge les controles et agents du registre", () => {
    expect(REGISTRE.map((c) => c.id)).toContain("bing-denivio-quotidien");
    expect(REGISTRE).toHaveLength(9);
    // Chaque agent Claude a son dossier de projet et sa duree maximale
    for (const agent of REGISTRE.filter((c) => c.type === "claude")) {
      expect(agent.projet).toMatch(/Projet/);
      expect(agent.dureeMaxMin).toBeGreaterThan(30);
    }
  });
});
