import { describe, expect, it } from "vitest";
import {
  agentsAttendus,
  duree,
  heurePrevue,
  lireConfigTaches,
  nbAgentsEnRetard,
  plusLongueDuree,
  rapportPromis,
  situationAgent,
  texteAttendu,
} from "./tachesPlanifiees";

describe("texteAttendu", () => {
  it("resume un agent attendu en une ligne", () => {
    const base = { titre: "Sante", site: "denivio.fr", heure: "09:04", message: "Lance a 09:04" };
    expect(texteAttendu({ ...base, situation: "bloque", rapport: null })).toBe(
      "Sante — denivio.fr — Bloque ? (09:04) : Lance a 09:04",
    );
    expect(texteAttendu({ ...base, heure: null, situation: "recu", rapport: {}, message: "RAS" })).toBe(
      "Sante — denivio.fr — Rapport recu : RAS",
    );
  });
});

const SKILL_SANTE = `Etapes...
8. Rapport pour SiteDashboard : ecris \`C:\\Users\\moi\\.claude\\rapports-agents\\denivio.fr\\<AAAA-MM-JJ>\\sante-prod.json\`.
Contenu : {"site":"denivio.fr","agent":"sante-prod","titre":"Sante de la prod","date":"AAAA-MM-JJ"}`;

// Dimanche 25 octobre 2026, 9 h 30 (heure locale)
const MAINTENANT = new Date(2026, 9, 25, 9, 30);

function lancement(h, m) {
  return new Date(2026, 9, 25, h, m).toISOString();
}

function config(taches) {
  return JSON.stringify({ scheduledTasks: taches });
}

describe("rapportPromis", () => {
  it("lit site, agent et titre du rapport promis dans les consignes", () => {
    expect(rapportPromis(SKILL_SANTE)).toEqual({
      site: "denivio.fr",
      agent: "sante-prod",
      titre: "Sante de la prod",
    });
  });

  it("accepte des barres obliques et l'absence de titre", () => {
    expect(rapportPromis("~/.claude/rapports-agents/x.fr/<AAAA-MM-JJ>/seo.json")).toEqual({
      site: "x.fr",
      agent: "seo",
      titre: null,
    });
  });

  it("ignore une tache qui ne promet pas de rapport", () => {
    expect(rapportPromis("Rappel : publier le post Reddit")).toBeNull();
    expect(rapportPromis(null)).toBeNull();
  });
});

describe("lireConfigTaches", () => {
  it("lit horaire, activation et dernier lancement", () => {
    const c = lireConfigTaches(
      config([
        { id: "a", cronExpression: "0 9 * * *", enabled: true, lastRunAt: "2026-10-25T07:04:00Z" },
        { id: "b", fireAt: 1, enabled: false },
        { pas: "d'id" },
      ]),
    );
    expect(c.get("a")).toEqual({
      cron: "0 9 * * *",
      actif: true,
      dernierLancement: "2026-10-25T07:04:00Z",
      nom: null,
    });
    expect(c.get("b").actif).toBe(false);
    expect(c.size).toBe(2);
  });

  it("renvoie une config vide sur un fichier absent ou casse", () => {
    expect(lireConfigTaches(null).size).toBe(0);
    expect(lireConfigTaches("{pas du json").size).toBe(0);
  });
});

describe("heurePrevue", () => {
  it("donne l'heure d'une tache quotidienne", () => {
    expect(heurePrevue("30 7 * * *", MAINTENANT)).toBe("07:30");
  });

  it("respecte le jour de semaine (le 25/10/2026 est un dimanche)", () => {
    expect(heurePrevue("0 7 * * 1", MAINTENANT)).toBeNull();
    expect(heurePrevue("0 7 * * 0", MAINTENANT)).toBe("07:00");
    expect(heurePrevue("0 7 * * 7", MAINTENANT)).toBe("07:00");
    expect(heurePrevue("0 7 * * 1-5", MAINTENANT)).toBeNull();
  });

  it("prend le premier passage de la journee", () => {
    expect(heurePrevue("15,45 8,20 * * *", MAINTENANT)).toBe("08:15");
    expect(heurePrevue("*/20 * * * *", MAINTENANT)).toBe("00:00");
  });

  it("applique le OU cron quand jour du mois et de semaine sont restreints", () => {
    expect(heurePrevue("0 7 25 * 1", MAINTENANT)).toBe("07:00");
    expect(heurePrevue("0 7 1 * 1", MAINTENANT)).toBeNull();
  });

  it("refuse une expression illisible", () => {
    expect(heurePrevue("tous les matins", MAINTENANT)).toBeNull();
    expect(heurePrevue("0 25 * * *", MAINTENANT)).toBeNull();
    expect(heurePrevue(null, MAINTENANT)).toBeNull();
  });
});

describe("duree et plusLongueDuree", () => {
  it("formate une duree", () => {
    expect(duree(40)).toBe("40 min");
    expect(duree(60)).toBe("1 h");
    expect(duree(95)).toBe("1 h 35");
  });

  it("retient la plus longue duree connue d'un agent", () => {
    const rapports = [
      { agent: "seo", debut: "2026-10-24T09:05:00+02:00", fin: "2026-10-24T10:22:00+02:00" },
      { agent: "seo", debut: "2026-10-23T09:00:00+02:00", fin: "2026-10-23T09:30:00+02:00" },
      { agent: "seo", debut: "2026-10-22T09:00:00+02:00" },
      { agent: "autre", debut: "2026-10-24T00:00:00+02:00", fin: "2026-10-24T05:00:00+02:00" },
    ];
    expect(plusLongueDuree(rapports, "seo")).toBe(77);
    expect(plusLongueDuree(rapports, "inconnu")).toBe(0);
  });
});

describe("situationAgent", () => {
  it("un rapport recu l'emporte sur tout le reste", () => {
    const r = situationAgent({
      lanceA: new Date(2026, 9, 25, 7, 0),
      rapport: { resume: "RAS" },
      maintenant: MAINTENANT,
    });
    expect(r).toEqual({ situation: "recu", message: "RAS" });
  });

  it("un agent lance recemment est en cours", () => {
    const r = situationAgent({ lanceA: new Date(2026, 9, 25, 9, 4), maintenant: MAINTENANT });
    expect(r.situation).toBe("en_cours");
    expect(r.message).toBe("Lance a 09:04");
  });

  it("un agent lance depuis trop longtemps sans rapport est presume bloque", () => {
    const r = situationAgent({ lanceA: new Date(2026, 9, 25, 8, 30), maintenant: MAINTENANT });
    expect(r.situation).toBe("bloque");
    expect(r.message).toMatch(/Lance a 08:30, toujours sans rapport apres 1 h/);
  });

  it("allonge le seuil pour un agent habituellement long", () => {
    const lanceA = new Date(2026, 9, 25, 8, 30);
    expect(situationAgent({ lanceA, dureeMaxMin: 77, maintenant: MAINTENANT }).situation).toBe(
      "en_cours",
    );
  });

  it("une heure prevue depassee sans lancement donne un agent pas lance", () => {
    expect(situationAgent({ prevueA: "08:00", maintenant: MAINTENANT })).toEqual({
      situation: "non_lance",
      message: "Prevu a 08:00, pas encore lance",
    });
    expect(situationAgent({ prevueA: "09:15", maintenant: MAINTENANT }).situation).toBe("prevu");
  });
});

describe("agentsAttendus", () => {
  const taches = [
    { id: "sante-prod", skill: SKILL_SANTE },
    { id: "seo", skill: "rapports-agents\\denivio.fr\\<AAAA-MM-JJ>\\seo.json" },
    { id: "hebdo", skill: "rapports-agents\\denivio.fr\\<AAAA-MM-JJ>\\hebdo.json" },
    { id: "rappel", skill: "Rappel sans rapport" },
    { id: "eteinte", skill: "rapports-agents\\x.fr\\<AAAA-MM-JJ>\\eteinte.json" },
    { id: "sans-config", skill: "rapports-agents\\x.fr\\<AAAA-MM-JJ>\\sans-config.json" },
  ];
  const reglages = config([
    // Prevue a 7 h 30, rattrapee a 9 h 04 : le cas du 25/10
    { id: "sante-prod", cronExpression: "30 7 * * *", enabled: true, lastRunAt: lancement(8, 4) },
    { id: "seo", cronExpression: "0 9 * * *", enabled: true, lastRunAt: lancement(9, 4) },
    { id: "hebdo", cronExpression: "0 7 * * 1", enabled: true },
    { id: "rappel", cronExpression: "0 9 * * *", enabled: true },
    { id: "eteinte", cronExpression: "0 9 * * *", enabled: false },
  ]);

  it("ne garde que les taches actives, qui promettent un rapport et tombent aujourd'hui", () => {
    const attendus = agentsAttendus({ taches, config: reglages, maintenant: MAINTENANT });
    expect(attendus.map((a) => a.id)).toEqual(["sante-prod", "seo"]);
  });

  it("signale l'agent bloque et compte les retards", () => {
    const attendus = agentsAttendus({ taches, config: reglages, maintenant: MAINTENANT });
    const sante = attendus.find((a) => a.id === "sante-prod");
    expect(sante).toMatchObject({
      site: "denivio.fr",
      titre: "Sante de la prod",
      prevueA: "07:30",
      heure: "08:04",
      situation: "bloque",
    });
    expect(attendus.find((a) => a.id === "seo").situation).toBe("en_cours");
    expect(nbAgentsEnRetard(attendus)).toBe(1);
  });

  it("rattache le rapport du jour a son agent", () => {
    const rapport = { agent: "sante-prod", date: "2026-10-25", statut: "ok", titre: "Sante", resume: "RAS" };
    const hier = { agent: "seo", date: "2026-10-24", statut: "ok", titre: "SEO" };
    const attendus = agentsAttendus({
      taches,
      config: reglages,
      rapports: [rapport, hier],
      maintenant: MAINTENANT,
    });
    expect(attendus[0]).toMatchObject({ situation: "recu", rapport, titre: "Sante" });
    expect(attendus[1].situation).toBe("en_cours");
  });

  it("n'attend rien sans le fichier de config de Claude", () => {
    expect(agentsAttendus({ taches, config: null, maintenant: MAINTENANT })).toEqual([]);
  });
});
