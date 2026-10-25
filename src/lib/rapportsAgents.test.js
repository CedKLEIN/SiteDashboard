import { describe, expect, it } from "vitest";
import {
  dateDepuis,
  decouperChemin,
  domaine,
  heureRapport,
  lireRapport,
  rattacherSite,
  regrouperParJournee,
  texteJournee,
  texteRapport,
  verdictJournee,
} from "./rapportsAgents";

describe("texteRapport et texteJournee", () => {
  const complet = {
    titre: "Sante de la prod",
    site: "denivio.fr",
    date: "2026-10-25",
    debut: "2026-10-25T09:04:00+01:00",
    statut: "attention",
    resume: "Une page lente",
    points: [
      { niveau: "ok", texte: "API OK" },
      { niveau: "attention", texte: "/cols lente (2 s)" },
    ],
    fichierSuivi: "C:\\suivi.md",
    chemin: "C:\\rapport.json",
  };

  it("met un rapport en texte, points et fichier de suivi compris", () => {
    expect(texteRapport(complet)).toBe(
      [
        "Sante de la prod — denivio.fr — 2026-10-25 09:04 — A regarder",
        "Une page lente",
        "- [OK] API OK",
        "- [A regarder] /cols lente (2 s)",
        "Fichier : C:\\suivi.md",
      ].join("\n"),
    );
  });

  it("se contente d'un rapport minimal et separe les rapports d'une journee", () => {
    const minimal = { titre: "seo", site: "x.fr", date: "2026-10-25", statut: "ok", chemin: "C:\\r.json" };
    expect(texteRapport(minimal)).toBe("seo — x.fr — 2026-10-25 — OK\nFichier : C:\\r.json");
    expect(texteJournee({ rapports: [minimal, minimal] })).toContain("C:\\r.json\n\nseo");
  });
});

const CHEMIN = "C:\\Users\\moi\\.claude\\rapports-agents\\denivio.fr\\2026-10-24\\sante-prod.json";

function fichier(donnees, chemin = CHEMIN) {
  return { chemin, contenu: JSON.stringify(donnees), erreur: null };
}

function rapport(statut, extra = {}) {
  return { statut, titre: "agent", date: "2026-10-24", site: "denivio.fr", ...extra };
}

describe("decouperChemin", () => {
  it("tire site, date et agent du chemin, quel que soit le separateur", () => {
    expect(decouperChemin(CHEMIN)).toEqual({
      site: "denivio.fr",
      date: "2026-10-24",
      agent: "sante-prod",
    });
    expect(decouperChemin("/home/moi/r/denivio.fr/2026-10-24/seo.JSON").agent).toBe("seo");
  });
});

describe("lireRapport", () => {
  it("lit un rapport complet", () => {
    const r = lireRapport(
      fichier({
        site: "denivio.fr",
        agent: "sante-prod-denivio-quotidienne",
        titre: "Sante de la prod",
        date: "2026-10-24",
        debut: "2026-10-24T07:41:00+02:00",
        statut: "attention",
        resume: "Une page lente",
        points: [{ niveau: "attention", texte: "/catalogs en 3 s" }, "Sitemap OK"],
        fichier: "C:\\suivi.md",
      }),
    );
    expect(r.statut).toBe("attention");
    expect(r.titre).toBe("Sante de la prod");
    expect(r.points).toEqual([
      { niveau: "attention", texte: "/catalogs en 3 s" },
      { niveau: "ok", texte: "Sitemap OK" },
    ]);
    expect(r.fichierSuivi).toBe("C:\\suivi.md");
  });

  it("complete site, date et agent depuis le chemin quand le JSON les omet", () => {
    const r = lireRapport(fichier({ statut: "ok" }));
    expect(r).toMatchObject({ site: "denivio.fr", date: "2026-10-24", agent: "sante-prod" });
  });

  it("ignore une date mal formee au profit de celle du dossier", () => {
    expect(lireRapport(fichier({ statut: "ok", date: "24/10/2026" })).date).toBe("2026-10-24");
  });

  it("fait d'un JSON invalide un rapport en echec, pas un rapport ignore", () => {
    const r = lireRapport({ chemin: CHEMIN, contenu: "{ pas du json" });
    expect(r.statut).toBe("echec");
    expect(r.resume).toMatch(/JSON invalide/);
  });

  it("fait d'une erreur de lecture un rapport en echec", () => {
    const r = lireRapport({ chemin: CHEMIN, contenu: null, erreur: "fichier trop lourd (300 Ko)" });
    expect(r.statut).toBe("echec");
    expect(r.resume).toContain("trop lourd");
  });

  it("traite un statut inconnu comme un echec en le nommant", () => {
    const r = lireRapport(fichier({ statut: "super", resume: "tout va bien" }));
    expect(r.statut).toBe("echec");
    expect(r.resume).toContain("« super »");
    expect(r.resume).toContain("tout va bien");
  });

  it("accepte un statut en majuscules", () => {
    expect(lireRapport(fichier({ statut: "OK" })).statut).toBe("ok");
  });
});

describe("verdictJournee", () => {
  it("vert quand tout est OK", () => {
    expect(verdictJournee([rapport("ok"), rapport("ok")])).toBe("ok");
  });

  it("orange quand un point est a regarder", () => {
    expect(verdictJournee([rapport("ok"), rapport("attention")])).toBe("partiel");
  });

  it("orange pour un echec isole parmi plusieurs rapports", () => {
    expect(verdictJournee([rapport("ok"), rapport("ok"), rapport("echec")])).toBe("partiel");
  });

  it("rouge des que la moitie des rapports sont en echec", () => {
    expect(verdictJournee([rapport("ok"), rapport("echec")])).toBe("ko");
    expect(verdictJournee([rapport("echec")])).toBe("ko");
  });

  it("un « a regarder » ne rend jamais la journee rouge", () => {
    expect(verdictJournee([rapport("attention"), rapport("attention")])).toBe("partiel");
  });

  it("aucun rapport : etat neutre", () => {
    expect(verdictJournee([])).toBe("aucun");
  });
});

describe("domaine et rattacherSite", () => {
  const sites = [
    { id: 1, nom: "Denivio", url: "https://www.denivio.fr/" },
    { id: 2, nom: "HistorySite", url: "https://roisempereurs.fr" },
    { id: 3, nom: "Brouillon", url: null },
  ];

  it("normalise un domaine", () => {
    expect(domaine("https://www.Denivio.fr/catalogs")).toBe("denivio.fr");
    expect(domaine("denivio.fr")).toBe("denivio.fr");
  });

  it("rattache par domaine, puis par nom", () => {
    expect(rattacherSite("denivio.fr", sites)?.id).toBe(1);
    expect(rattacherSite("Brouillon", sites)?.id).toBe(3);
    expect(rattacherSite("inconnu.fr", sites)).toBeNull();
  });
});

describe("regrouperParJournee", () => {
  it("fait une ligne par site et par jour, la plus recente d'abord", () => {
    const lignes = regrouperParJournee([
      rapport("ok", { date: "2026-10-23", titre: "a" }),
      rapport("echec", { date: "2026-10-24", titre: "b", debut: "2026-10-24T09:00:00" }),
      rapport("ok", { date: "2026-10-24", titre: "c", debut: "2026-10-24T07:30:00" }),
      rapport("ok", { date: "2026-10-24", site: "roisempereurs.fr", titre: "d" }),
    ]);
    expect(lignes.map((l) => `${l.date} ${l.site}`)).toEqual([
      "2026-10-24 denivio.fr",
      "2026-10-24 roisempereurs.fr",
      "2026-10-23 denivio.fr",
    ]);
    // Ordre de passage dans la journee
    expect(lignes[0].rapports.map((r) => r.titre)).toEqual(["c", "b"]);
    expect(lignes[0].compte).toEqual({ ok: 1, attention: 0, echec: 1 });
    expect(lignes[0].verdict).toBe("ko");
  });

  it("confond www et domaine nu dans la meme ligne", () => {
    const lignes = regrouperParJournee([
      rapport("ok", { site: "denivio.fr" }),
      rapport("ok", { site: "www.denivio.fr" }),
    ]);
    expect(lignes).toHaveLength(1);
  });
});

describe("dates", () => {
  it("calcule la date de debut d'historique en date locale", () => {
    expect(dateDepuis(30, new Date(2026, 9, 24, 23, 30))).toBe("2026-09-24");
  });

  it("extrait l'heure d'un horodatage ISO", () => {
    expect(heureRapport("2026-10-24T09:12:00+02:00")).toBe("09:12");
    expect(heureRapport(null)).toBeNull();
  });
});
