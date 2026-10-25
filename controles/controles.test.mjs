// @vitest-environment node
import { describe, expect, it } from "vitest";
import { empreinte, isoLocal, jsonLd, liens, meta, pointsDuRapport, statutGlobal, texteVisible, racine } from "./lib/commun.mjs";
import { extraireJson, validerAnalyse } from "./lib/claude.mjs";
import { analyserCatalogue, analyserHistoire, clesObjet, hausses, souverainsCites } from "./lib/donnees.mjs";
import { defautsSeo, locs } from "./sante-prod.mjs";
import { aSoumettre, ordonner } from "./bing.mjs";
import { avecAnalyse } from "./lancer.mjs";
import { preambule } from "./lib/agent.mjs";

describe("agents Claude", () => {
  it("previent la session qu'elle tourne seule, et lui donne Chrome si besoin", () => {
    const controle = { titre: "Indexation Google", site: "denivio.fr", chrome: true };
    const texte = preambule(controle, new Date(2026, 9, 26, 9, 0));
    expect(texte).toContain("Session lancée automatiquement par SiteDashboard (tâche « Indexation Google », site denivio.fr), le 26/10/2026 à 09:00");
    expect(texte).toContain("Produis TOUJOURS le rapport JSON");
    expect(texte).toContain("mcp__claude-in-chrome__*");
    expect(preambule({ ...controle, chrome: false })).not.toContain("Chrome");
  });
});

describe("verdict et rapport", () => {
  const points = [
    { niveau: "ok", texte: "13/13 pages en 200" },
    { niveau: "attention", texte: "Page lente : /cols 2,41 s", sansAnalyse: false },
    { niveau: "echec", texte: "API en panne : /api/public/stats : HTTP 502" },
  ];

  it("prend le pire niveau, et met les anomalies en tete du rapport", () => {
    expect(statutGlobal(points)).toBe("echec");
    expect(statutGlobal([{ niveau: "ok", texte: "x" }])).toBe("ok");
    expect(pointsDuRapport(points).map((p) => p.niveau)).toEqual(["echec", "attention", "ok"]);
    // Les marqueurs internes ne partent pas dans le rapport
    expect(Object.keys(pointsDuRapport(points)[1])).toEqual(["niveau", "texte"]);
  });

  it("donne la meme empreinte a une anomalie dont seuls les chiffres changent", () => {
    const demain = [{ niveau: "attention", texte: "Page lente : /cols 2,87 s" }];
    expect(empreinte([points[1]])).toBe(empreinte(demain));
    expect(empreinte([points[1]])).not.toBe(empreinte([points[2]]));
    expect(empreinte([points[0]])).toBe("");
  });

  it("date en heure locale avec le decalage", () => {
    expect(isoLocal(new Date(2026, 9, 25, 9, 5, 7))).toMatch(/^2026-10-25T09:05:07[+-]\d{2}:\d{2}$/);
  });
});

describe("lecture du HTML", () => {
  const html = `<html><head><title>Col du Galibier — Denivio</title>
    <meta name="description" content="Fiche du col">
    <meta property="og:title" content="Col du Galibier">
    <link rel="canonical" href="https://denivio.fr/catalogs/col-du-galibier">
    <link rel="alternate" hreflang="fr" href="https://x.fr/a"><link rel="alternate" hreflang="en" href="https://x.fr/en/a">
    <script type="application/ld+json" id="seo-structured-data">{"@type":"BreadcrumbList"}</script>
    </head><body><div id="root"><h1>Col du Galibier</h1><p>2642 m</p></div></body></html>`;

  it("lit balises, liens, JSON-LD et texte de #root", () => {
    expect(meta(html, "description")).toBe("Fiche du col");
    expect(meta(html, "og:title")).toBe("Col du Galibier");
    expect(liens(html, "canonical")[0].href).toBe("https://denivio.fr/catalogs/col-du-galibier");
    expect(liens(html, "alternate").map((l) => l.hreflang)).toEqual(["fr", "en"]);
    expect(jsonLd(html)).toEqual([{ id: "seo-structured-data", donnees: { "@type": "BreadcrumbList" } }]);
    expect(texteVisible(racine(html))).toBe("Col du Galibier 2642 m");
  });

  it("ne trouve aucun defaut SEO a une page complete", () => {
    const url = "https://denivio.fr/catalogs/col-du-galibier";
    expect(defautsSeo(html, url, { titreAccueil: "Denivio", jsonLdId: "seo-structured-data", jsonLdType: "BreadcrumbList", hreflang: true })).toEqual([]);
  });

  it("liste chaque defaut SEO", () => {
    const pauvre = `<html><head><title>Denivio</title><link rel="canonical" href="https://denivio.fr/"></head><body><div id="root"><p>x</p></div></body></html>`;
    expect(defautsSeo(pauvre, "https://denivio.fr/cols", { titreAccueil: "Denivio", jsonLdId: "seo-structured-data" })).toEqual([
      "title identique a l'accueil",
      "meta description absente",
      "canonical vers https://denivio.fr/",
      "og:title absent",
      "pas de h1 dans #root",
      "JSON-LD #seo-structured-data absent",
    ]);
  });

  it("lit les URL d'un sitemap", () => {
    expect(locs("<urlset><url><loc>https://a.fr/</loc></url><url><loc> https://a.fr/b </loc></url></urlset>")).toEqual([
      "https://a.fr/",
      "https://a.fr/b",
    ]);
    expect(locs(null)).toEqual([]);
  });
});

describe("donnees", () => {
  it("repere les anomalies du catalogue, outre-mer a part", () => {
    const lieu = (name, extra = {}) => ({ name, country: "France", latitude: 45, longitude: 6, altitude: 1000, sourceName: "OSM", featureType: "Pass", ...extra });
    const a = analyserCatalogue([
      lieu("Col de l'Arc"),
      lieu("Col de l’Arc", { latitude: 45.1 }),
      lieu("Col d'Ouano", { latitude: -21.6, longitude: 165.7 }),
      lieu("Sans coordonnees", { latitude: null }),
      lieu("Trop haut", { altitude: 5000, latitude: 45.2 }),
      lieu("Glavica [HRRGIM76701]", { latitude: 45.3 }),
      lieu("Doublon de position", { latitude: 45.2 }),
    ]);
    expect(a.anomalies.nomsEnDouble.nombre).toBe(1);
    expect(a.anomalies.horsEurope.nombre).toBe(1);
    expect(a.anomalies.coordonneesManquantes.nombre).toBe(1);
    expect(a.anomalies.altitudeHorsBornes.nombre).toBe(1);
    expect(a.anomalies.nomSuspect.nombre).toBe(1);
    expect(a.anomalies.coordonneesEnDouble.nombre).toBe(1);
    expect(a.total).toBe(7);
  });

  it("lit les cles des bios, nues, entre guillemets ou mal indentees", () => {
    const source = "export const BIOS = {\n  'Clovis Ier': [\n    'texte : [non]',\n  ],\n  Charlemagne: [\n  ],\n   'Emmanuel Macron': [\n  ],\n}";
    expect(clesObjet(source)).toEqual(["Clovis Ier", "Charlemagne", "Emmanuel Macron"]);
    expect(souverainsCites("{ ruler: 'Clovis Ier' }, { ruler: \"Charlemagne\" }")).toEqual(["Clovis Ier", "Charlemagne"]);
  });

  it("verifie la coherence des contenus de HistorySite", () => {
    const instantane = [
      { id: 1, name: "Clovis Ier", startYear: 481, endYear: 511, parentId: null },
      { id: 2, name: "Charlemagne", startYear: 814, endYear: 768, parentId: 99 },
    ];
    const r = analyserHistoire({
      souverains: [{ name: "Clovis Ier" }, { name: "Charlemagne" }],
      instantane,
      biosFr: ["Clovis Ier", "Charlemagne"],
      biosEn: ["Clovis Ier"],
      datesFr: ["Clovis Ier", "Louis XXX"],
      datesEn: [],
      portraits: { Charlemagne: { src: "/images/c.jpg" } },
      fichierExiste: () => false,
    });
    expect(r.anomalies).toMatchObject({
      sansBioEn: ["Charlemagne"],
      dateCleOrpheline: ["Louis XXX"],
      portraitIntrouvable: ["Charlemagne"],
      regneIncoherent: ["Charlemagne"],
      lienCasse: ["Charlemagne"],
      seulementEnProd: [],
    });
  });

  it("ne signale que les categories en hausse par rapport a la semaine passee", () => {
    expect(hausses({ a: { nombre: 3 }, b: ["x"], c: { nombre: 9 } }, { a: 2, b: 1 })).toEqual([{ cle: "a", avant: 2, apres: 3 }]);
  });
});

describe("Bing", () => {
  it("soumet d'abord les pages hors fiches, sans les URL deja soumises", () => {
    const sitemap = ["https://d.fr/catalogs/galibier", "https://d.fr/cols/isere", "https://d.fr/", "https://d.fr/catalogs/izoard"];
    expect(aSoumettre(sitemap, ["https://d.fr/", ""])).toEqual([
      "https://d.fr/cols/isere",
      "https://d.fr/catalogs/galibier",
      "https://d.fr/catalogs/izoard",
    ]);
    expect(ordonner(["https://d.fr/catalogs", "https://d.fr/catalogs/x"])).toEqual(["https://d.fr/catalogs", "https://d.fr/catalogs/x"]);
  });
});

describe("analyse par Claude", () => {
  it("extrait et valide le JSON de la reponse", () => {
    const reponse = 'Voici :\n{"statut":"attention","resume":"Lenteur passagere","points":[{"niveau":"attention","texte":"pic {nginx}"},{"niveau":"bof","texte":"x"}],"analyse":"Rien de grave."}\nFin.';
    expect(validerAnalyse(extraireJson(reponse))).toEqual({
      statut: "attention",
      resume: "Lenteur passagere",
      points: [{ niveau: "attention", texte: "pic {nginx}" }],
      analyse: "Rien de grave.",
    });
    expect(validerAnalyse(extraireJson("pas de json"))).toBeNull();
    expect(validerAnalyse({ statut: "grave", resume: "x" })).toBeNull();
  });

  it("remplace le resume par celui de Claude et signale une analyse reprise", () => {
    const rapport = { statut: "echec", resume: "script", points: [{ niveau: "echec", texte: "x" }], source: "script" };
    const analyse = { statut: "attention", resume: "Faux positif probable", points: [], analyse: "" };
    expect(avecAnalyse(rapport, analyse)).toMatchObject({ statut: "attention", resume: "Faux positif probable", points: rapport.points, source: "script+claude" });
    expect(avecAnalyse(rapport, analyse, { reprise: "24/10/2026" }).resume).toBe("Faux positif probable (analyse du 24/10/2026)");
  });
});
