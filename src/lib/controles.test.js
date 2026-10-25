import { describe, expect, it } from "vitest";
import { controlesDus, dernierPassagePrevu, fusionnerTaches, horaireLisible, REGISTRE } from "./controles";

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

  it("charge les cinq controles du registre", () => {
    expect(REGISTRE.map((c) => c.id)).toContain("bing-denivio-quotidien");
    expect(REGISTRE).toHaveLength(5);
  });
});
