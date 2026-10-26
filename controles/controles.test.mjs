// @vitest-environment node
import { describe, expect, it } from "vitest";
import { archiverRapport, empreinte, isoLocal, jsonLd, liens, meta, pointsDuRapport, statutGlobal, texteVisible, racine } from "./lib/commun.mjs";
import { extraireJson, validerAnalyse } from "./lib/claude.mjs";
import { analyserCatalogue, analyserHistoire, clesObjet, hausses, souverainsCites } from "./lib/donnees.mjs";
import { configSante, defautsSeo, locs, verifierApi } from "./sante-prod.mjs";
import { aSoumettre, configBing, ordonner } from "./bing.mjs";
import { avecAnalyse } from "./lancer.mjs";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONSIGNE_TEST_CHROME, chromeConnecte, construireConsigne, messageChromeDeconnecte, preambule } from "./lib/agent.mjs";
import { DOSSIER_MODELES, ajouterAgent, applicables, chargerTout, composer, identifiant, pourInterface, rendre, retirerAgent } from "./lib/registre.mjs";
import { chromeDansListe, cookiesClaudeEffaces, trouverChrome } from "./lib/chrome.mjs";

describe("agents Claude", () => {
  it("previent la session qu'elle tourne seule, et lui donne Chrome si besoin", () => {
    const controle = { titre: "Indexation Google", site: "denivio.fr", chrome: true };
    const texte = preambule(controle, new Date(2026, 9, 26, 9, 0));
    expect(texte).toContain("Session lancée automatiquement par SiteDashboard (tâche « Indexation Google », site denivio.fr), le 26/10/2026 à 09:00");
    expect(texte).toContain("Produis TOUJOURS le rapport JSON");
    expect(texte).toContain("mcp__claude-in-chrome__*");
    expect(texte).toContain("ferme chacun de tes onglets");
    expect(preambule({ ...controle, chrome: false })).not.toContain("Chrome");
  });
});

describe("test de connexion a Chrome avant un agent", () => {
  it("reconnait la reponse de connexion, pas le refus", () => {
    expect(chromeConnecte("CHROME_CONNECTE")).toBe(true);
    expect(chromeConnecte("Résultat :\nCHROME_CONNECTE\n")).toBe(true);
    expect(chromeConnecte("CHROME_NON_CONNECTE Browser extension is not connected.")).toBe(false);
    expect(chromeConnecte("")).toBe(false);
    expect(chromeConnecte(undefined)).toBe(false);
  });

  it("la consigne ne demande qu'une action et une reponse fixe", () => {
    // Liste les navigateurs relies, sans ouvrir d'onglet ni de groupe
    expect(CONSIGNE_TEST_CHROME).toContain("mcp__claude-in-chrome__list_connected_browsers");
    expect(CONSIGNE_TEST_CHROME).not.toContain("createIfEmpty");
    expect(CONSIGNE_TEST_CHROME).toContain("CHROME_CONNECTE");
  });

  it("demande a l'agent Chrome de fermer tous ses onglets a la fin", () => {
    const texte = preambule({ titre: "Indexation Google", site: "denivio.fr", chrome: true });
    expect(texte).toContain("mcp__claude-in-chrome__tabs_close_mcp");
    expect(texte).toContain("DERNIÈRE ÉTAPE OBLIGATOIRE");
    expect(preambule({ titre: "Santé", site: "denivio.fr" })).not.toContain("tabs_close_mcp");
  });

  it("repere un Chrome qui efface les cookies de claude.ai a la fermeture", () => {
    const prefs = (defaut, exceptions = {}) => ({
      profile: { default_content_setting_values: { cookies: defaut }, content_settings: { exceptions: { cookies: exceptions } } },
    });
    expect(cookiesClaudeEffaces(prefs(4))).toBe(true);
    expect(cookiesClaudeEffaces(prefs(undefined))).toBe(false);
    // Une exception qui garde claude.ai suffit
    expect(cookiesClaudeEffaces(prefs(4, { "[*.]claude.ai,*": { setting: 1 } }))).toBe(false);
    expect(cookiesClaudeEffaces(prefs(1, { "https://claude.ai:443,*": { setting: 4 } }))).toBe(true);
    expect(cookiesClaudeEffaces(prefs(4, { "[*.]notclaude.ai,*": { setting: 1 } }))).toBe(true);
    expect(cookiesClaudeEffaces(undefined)).toBe(false);
  });

  it("donne la cause quand Chrome efface les cookies a la fermeture", () => {
    expect(messageChromeDeconnecte("moi@exemple.fr", { cookiesEffaces: true })).toContain("chrome://settings/content/siteData");
    expect(messageChromeDeconnecte("moi@exemple.fr")).not.toContain("chrome://settings");
  });

  it("dit quoi faire, avec le compte de Claude Code, et annonce le nouvel essai", () => {
    const message = messageChromeDeconnecte("moi@exemple.fr");
    expect(message).toContain("rien n'a été fait");
    expect(message).toContain("connecte-toi avec le compte moi@exemple.fr");
    expect(message).toContain("toutes les 30 minutes");
    expect(messageChromeDeconnecte(null)).not.toContain("compte null");
  });
});

describe("Chrome pour les agents", () => {
  it("reconnait Chrome dans la sortie de tasklist", () => {
    expect(chromeDansListe("\r\nchrome.exe                   12345 Console    1    250 000 Ko\r\n")).toBe(true);
    expect(chromeDansListe("INFO : aucune tâche en service ne correspond aux critères spécifiés.\r\n")).toBe(false);
  });

  it("cherche chrome.exe dans l'installation par utilisateur puis pour tous", () => {
    expect(trouverChrome({ LOCALAPPDATA: "Z:\\absent", ProgramFiles: "Z:\\absent2" })).toBeNull();
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
    const motif = "^/catalogs/[^/]+$";
    expect(aSoumettre(sitemap, ["https://d.fr/", ""], motif)).toEqual([
      "https://d.fr/cols/isere",
      "https://d.fr/catalogs/galibier",
      "https://d.fr/catalogs/izoard",
    ]);
    expect(ordonner(["https://d.fr/catalogs/x", "https://d.fr/catalogs"], motif)).toEqual(["https://d.fr/catalogs", "https://d.fr/catalogs/x"]);
    // Sans motif de fiches : l'ordre du sitemap
    expect(ordonner(["https://d.fr/b", "https://d.fr/a"])).toEqual(["https://d.fr/b", "https://d.fr/a"]);
  });

  it("tire sa configuration de la fiche du site", () => {
    const controle = { fiche: { url: "https://d.fr/", bing: { fiches: "^/x/" } }, fichierSuivi: "C:\\p\\soumises.txt" };
    expect(configBing(controle)).toEqual({ site: "https://d.fr/", sitemap: "https://d.fr/sitemap.xml", soumises: "C:\\p\\soumises.txt", fiches: "^/x/" });
  });
});

describe("Santé : fiche du site", () => {
  it("verifie une reponse d'API avec les regles de la fiche", () => {
    expect(verifierApi({ a: 0, b: 3 }, { unNombrePositif: true })).toBe(true);
    expect(verifierApi({ a: 0 }, { unNombrePositif: true })).toBe("aucun nombre non nul");
    expect(verifierApi({ mode: "x" }, { champs: ["mode", "total"] })).toBe("total absent");
    expect(verifierApi([], { listeNonVide: true })).toBe("liste vide");
    expect(verifierApi([{ name: "A" }, { name: "" }], { listeNonVide: true, champElements: "name" })).toBe("1 élément(s) sans name");
    expect(verifierApi({ n: 1 }, { chemin: "/api" })).toBe(true);
  });

  it("complete la configuration avec des valeurs par defaut", () => {
    const c = configSante({ url: "https://d.fr/", sante: { pages: ["/", "/a"] } });
    expect(c).toMatchObject({ base: "https://d.fr", hote: "d.fr", sitemap: "https://d.fr/sitemap.xml", pages: ["/", "/a"], api: [], version: null });
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

describe("registre : modeles appliques aux sites", () => {
  const modeles = [
    { id: "sante-prod", titre: "Santé", type: "script", script: "sante-prod.mjs", cron: "30 7 * * *", requis: ["url", "sante"], suivi: "sante-{{site.cle}}.md" },
    { id: "idees", titre: "Idées", type: "claude", consigne: "idees.md", chrome: true, dureeMaxMin: 90, cron: "0 10 * * 6", requis: ["url"], parametres: { corriger: false } },
    { id: "bing", titre: "Bing", type: "script", cron: "0 9 * * *", requis: ["url"] },
  ];
  const sites = [
    { cle: "a", nom: "Site A", domaine: "a.fr", url: "https://a.fr", projet: "C:\\p\\a", sante: { pages: ["/"] } },
    { cle: "b", nom: "Site B", domaine: "b.fr", url: "https://b.fr", projet: "C:\\p\\b" },
  ];

  it("compose un agent : horaire du modele ou de l'agent, fichier de suivi, parametres", () => {
    const [sante, idees] = composer({
      modeles,
      sites,
      agents: [
        { id: "sante-a", modele: "sante-prod", site: "a", cron: "45 7 * * *" },
        { id: "idees-a", modele: "idees", site: "a", parametres: { corriger: true } },
        { id: "bing-a", modele: "bing", site: "a" },
      ],
    });
    expect(sante).toMatchObject({ site: "a.fr", titre: "Santé", cron: "45 7 * * *", fichierSuivi: "C:\\p\\a\\sante-a.md", type: "script" });
    expect(sante.erreur).toBeUndefined();
    expect(idees).toMatchObject({ cron: "0 10 * * 6", chrome: true, dureeMaxMin: 90, parametres: { corriger: true }, soumissionBingAuto: true });
  });

  it("compose une tache sans horaire, avec ce qui la declenche", () => {
    const correctifs = { id: "correctifs", titre: "Correctifs", type: "script", script: "correctifs.mjs", cron: null, declenchePar: "audit-hebdo", requis: ["correctifs.dossier"] };
    const fiches = [{ ...sites[0], correctifs: { dossier: "C:\\p\\a\\front", verifications: ["npm test"] } }, sites[1]];
    const [a, b] = composer({
      modeles: [correctifs],
      sites: fiches,
      agents: [
        { id: "correctifs-a", modele: "correctifs", site: "a" },
        { id: "correctifs-b", modele: "correctifs", site: "b" },
      ],
    });
    expect(a).toMatchObject({ cron: null, declenchePar: "audit-hebdo" });
    expect(a.erreur).toBeUndefined();
    expect(b.erreur).toBe("fiche b incomplète : correctifs.dossier");
    expect(pourInterface([a])[0]).toMatchObject({ id: "correctifs-a", cron: null, declenchePar: "audit-hebdo" });
  });

  it("garde visible un agent mal configure", () => {
    const [inconnu, sansFiche, incomplet] = composer({
      modeles,
      sites,
      agents: [
        { id: "x", modele: "nope", site: "a" },
        { id: "y", modele: "idees", site: "zz" },
        { id: "z", modele: "sante-prod", site: "b" },
      ],
    });
    expect(inconnu.erreur).toBe("modèle inconnu : nope");
    expect(sansFiche.erreur).toBe("fiche de site introuvable : zz");
    expect(incomplet.erreur).toBe("fiche b incomplète : sante");
  });

  it("propose chaque modele avec les sites possibles", () => {
    const [sante] = applicables({ modeles, sites, agents: [{ id: "s", modele: "sante-prod", site: "a" }] });
    expect(sante.sites).toEqual([
      { cle: "a", nom: "Site A", domaine: "a.fr", manquants: [], deja: true },
      { cle: "b", nom: "Site B", domaine: "b.fr", manquants: ["sante"], deja: false },
    ]);
  });

  it("donne un identifiant libre", () => {
    expect(identifiant(modeles[0], sites[0], [])).toBe("sante-prod-a");
    expect(identifiant(modeles[0], sites[0], ["sante-prod-a"])).toBe("sante-prod-a-2");
  });

  it("remplit une consigne, conditions comprises", () => {
    const modele = "{{site.nom}} : {{#si agent.corriger}}corrige{{#sinon}}ne touche à rien{{/si}}.{{#si site.absent}} jamais{{/si}} {{inconnu}}fin";
    expect(rendre(modele, { site: { nom: "A" }, agent: { corriger: true } })).toBe("A : corrige. fin");
    expect(rendre(modele, { site: { nom: "A" }, agent: { corriger: false } })).toBe("A : ne touche à rien. fin");
    expect(rendre("{{#si a}}x{{#si b}}y{{/si}}{{/si}}", { a: 1, b: 0 })).toBe("x");
  });

  it("ajoute et retire un agent dans le fichier", () => {
    const dossier = mkdtempSync(path.join(os.tmpdir(), "registre-"));
    const sources = { modeles: path.join(dossier, "m"), sites: path.join(dossier, "s"), agents: path.join(dossier, "agents.json") };
    mkdirSync(sources.modeles);
    mkdirSync(sources.sites);
    writeFileSync(path.join(sources.modeles, "idees.json"), JSON.stringify(modeles[1]));
    writeFileSync(path.join(sources.sites, "a.json"), JSON.stringify(sites[0]));
    writeFileSync(path.join(sources.sites, "b.json"), `\uFEFF${JSON.stringify(sites[1])}`);
    expect(ajouterAgent("idees", "b", sources)).toEqual({ id: "idees-b", modele: "idees", site: "b" });
    expect(() => ajouterAgent("idees", "zz", sources)).toThrow("fiche de site introuvable");
    expect(chargerTout(sources).agents.map((a) => a.id)).toEqual(["idees-b"]);
    retirerAgent("idees-b", sources);
    expect(chargerTout(sources).agents).toEqual([]);
    rmSync(dossier, { recursive: true });
  });

  it("construit la consigne d'un agent : modele, fiche, rapport, precisions", () => {
    const dossier = mkdtempSync(path.join(os.tmpdir(), "consigne-"));
    writeFileSync(path.join(dossier, "idees.md"), "Site {{site.nom}} ({{agent.fichierSuiviNom}}). Rapport : {{agent.consigneRapport}}");
    writeFileSync(path.join(dossier, "idees-a.md"), "- parcours : accueil");
    const [agent] = composer({ modeles: [{ ...modeles[1], suivi: "idees-{{site.cle}}.md" }], sites, agents: [{ id: "idees-a", modele: "idees", site: "a" }] });
    const texte = construireConsigne({ ...agent, fiche: sites[0] }, { modeles: dossier, agents: dossier });
    expect(texte).toContain("Site Site A (idees-a.md)");
    expect(texte).toContain('"agent":"idees-a","titre":"Idées"');
    expect(texte).toContain(path.join("a.fr", "<AAAA-MM-JJ>", "idees-a.json"));
    expect(texte).toMatch(/Précisions propres à ce site[\s\S]*parcours : accueil$/);
    expect(construireConsigne({ ...agent, consigne: "absent.md" }, { modeles: dossier, agents: dossier })).toBeNull();
    rmSync(dossier, { recursive: true });
  });

  it("livre des modeles complets, et une consigne pour chaque agent Claude", () => {
    const { modeles: livres } = chargerTout({ sites: "absent", agents: "absent.json" });
    expect(livres.map((m) => m.id).sort()).toEqual(["audit-hebdo", "bing", "correctifs", "idees-hebdo", "indexation-seo", "sante-prod"]);
    for (const m of livres) {
      expect(m).toMatchObject({ titre: expect.any(String), description: expect.any(String) });
      // Sans horaire, une tache doit dire qui la declenche (sinon elle ne part qu'a la main)
      if (m.cron === null) expect(livres.map((x) => x.id)).toContain(m.declenchePar);
      else expect(m.cron).toMatch(/^\d+ \d+ \* \* [\d*,-]+$/);
      if (m.type === "claude") expect(existsSync(path.join(DOSSIER_MODELES, m.consigne))).toBe(true);
      else expect(existsSync(path.join(import.meta.dirname, m.script))).toBe(true);
    }
  });
});

describe("historique des passages d'un meme jour", () => {
  it("garde le rapport precedent sous <agent>@<heure de debut>.json avant une relance", () => {
    const dossier = mkdtempSync(path.join(os.tmpdir(), "rapports-"));
    try {
      const chemin = path.join(dossier, "indexation.json");
      expect(archiverRapport(chemin)).toBeNull();
      writeFileSync(chemin, JSON.stringify({ debut: "2026-10-26T09:12:05+01:00" }));
      expect(path.basename(archiverRapport(chemin))).toBe("indexation@091205.json");
      expect(existsSync(chemin)).toBe(false);
      // Deux passages a la meme seconde ne s'ecrasent pas
      writeFileSync(chemin, JSON.stringify({ debut: "2026-10-26T09:12:05+01:00" }));
      expect(path.basename(archiverRapport(chemin))).toBe("indexation@091205-2.json");
      expect(readdirSync(dossier).sort()).toEqual(["indexation@091205-2.json", "indexation@091205.json"]);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});
