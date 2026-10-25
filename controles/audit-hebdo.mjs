/**
 * Audit hebdomadaire, en RAPPORT SEULEMENT : performance de la prod (Playwright,
 * mediane de 3 chargements a froid), coherence des donnees, dependances.
 *
 * Reprend les consignes des agents « Audit hebdo ». Attention en cas de
 * regression de performance (LCP +30 %, octets +20 % sur une semaine), de
 * vulnerabilite haute ou critique, ou d'une categorie d'anomalies de donnees
 * en hausse. Rien n'est modifie : ni code, ni paquet, ni donnee.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { nombre, obtenir, secondes, tableau } from "./lib/commun.mjs";
import { analyserCatalogue, analyserHistoire, clesObjet, hausses, souverainsCites, tailles } from "./lib/donnees.mjs";
import { mesurerPerformance } from "./lib/navigateur.mjs";

const SPORT = "C:\\Users\\cedao\\Documents\\Projet\\SportSite";
const HISTOIRE = "C:\\Users\\cedao\\Documents\\Projet\\HistorySite";

export const CONFIGS = {
  denivio: {
    base: "https://denivio.fr",
    pages: ["/", "/catalogs", "/catalogs/col-du-galibier", "/collections/les-geants-des-alpes"],
    donnees: "catalogue",
    front: path.join(SPORT, "SportSiteFrontend"),
    back: path.join(SPORT, "SportSiteBackend", "SportSiteBackend.sln"),
  },
  roisempereurs: {
    base: "https://roisempereurs.fr",
    pages: ["/", "/souverain/louis-xiv", "/dynastie/capetiens", "/quiz"],
    donnees: "histoire",
    front: path.join(HISTOIRE, "HistorySiteFrontend"),
    back: path.join(HISTOIRE, "HistorySiteBackend", "HistorySiteBackend.sln"),
    bundle: path.join(HISTOIRE, "HistorySiteFrontend", "dist", "assets"),
  },
};

const ko = (octets) => `${nombre(Math.round(octets / 1024))} Ko`;

/** Commande qui peut sortir en erreur tout en ayant ecrit son resultat (npm outdated, audit). */
function sortieDe(commande, args, cwd) {
  try {
    return execFileSync(commande, args, { cwd, encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60 * 1000 });
  } catch (e) {
    if (e.stdout) return e.stdout;
    throw e;
  }
}

/* ----------------------------------------------------------- performance */

async function auditPerformance(c, etat, ajouter) {
  const mesures = {};
  for (const chemin of c.pages) mesures[chemin] = await mesurerPerformance(c.base + chemin);
  const avant = etat.performance ?? {};
  const regressions = [];
  for (const [chemin, m] of Object.entries(mesures)) {
    const p = avant[chemin];
    if (!p) continue;
    if (p.lcp > 0 && m.lcp > p.lcp * 1.3 && m.lcp - p.lcp > 200) regressions.push(`${chemin} LCP ${secondes(p.lcp)} → ${secondes(m.lcp)}`);
    if (p.octets > 0 && m.octets > p.octets * 1.2) regressions.push(`${chemin} poids ${ko(p.octets)} → ${ko(m.octets)}`);
  }
  if (regressions.length) ajouter("attention", `Régression de performance : ${regressions.join(" ; ")}`);
  const erreurs = Object.entries(mesures).flatMap(([chemin, m]) => m.erreurs.map((e) => `${chemin} : ${e}`));
  if (erreurs.length) ajouter("attention", `Erreurs de console : ${erreurs.slice(0, 2).join(" ; ")}`);
  const pire = Object.entries(mesures).sort((a, b) => b[1].lcp - a[1].lcp)[0];
  ajouter("ok", `Performance : LCP de ${secondes(Math.min(...Object.values(mesures).map((m) => m.lcp)))} à ${secondes(pire[1].lcp)} (${pire[0]})`);
  const lignes = Object.entries(mesures).map(([chemin, m]) => [
    chemin, secondes(m.lcp), m.cls, `${m.tbt} ms`, secondes(m.chargement), m.requetes, m.requetesApi, ko(m.octets),
  ]);
  return {
    mesures,
    section: `### Performance (médiane de 3 chargements à froid)\n\n${tableau(["Page", "LCP", "CLS", "TBT", "Chargement", "Requêtes", "dont /api", "Poids"], lignes)}`,
  };
}

/* --------------------------------------------------------------- donnees */

async function donneesCatalogue(etat, ajouter) {
  const seed = path.join(SPORT, "SportSiteBackend", "SportSiteBackend", "Asset", "SeedData", "catalog-seed.json");
  const analyse = analyserCatalogue(JSON.parse(readFileSync(seed, "utf8")));
  const stats = await obtenir("https://denivio.fr/api/public/stats");
  let prod = null;
  try {
    prod = JSON.parse(stats.texte).catalogCount;
  } catch {
    // stats indisponibles : simple information
  }
  const resume = tailles(analyse.anomalies);
  // horsEurope (outre-mer) grandit avec le seed : une information, pas une derive
  const { horsEurope: _horsEurope, ...surveillees } = analyse.anomalies;
  const enHausse = hausses(surveillees, etat.donnees);
  // Premier passage : seules les anomalies qui empechent d'afficher un lieu comptent
  const critiques = ["coordonneesManquantes", "altitudeHorsBornes", "paysVide"].filter((k) => resume[k] > 0);
  if (enHausse.length) ajouter("attention", `Données en hausse : ${enHausse.map((h) => `${h.cle} ${h.avant} → ${h.apres}`).join(", ")}`);
  else if (!etat.donnees && critiques.length) ajouter("attention", `Données : ${critiques.map((k) => `${k} ${resume[k]}`).join(", ")}`);
  ajouter("ok", `Catalogue : ${nombre(analyse.total)} lieux dans le seed, ${nombre(prod)} en prod`);
  const lignes = Object.entries(analyse.anomalies).map(([cle, v]) => [cle, v.nombre, v.exemples.slice(0, 3).join(" ; ")]);
  return {
    resume,
    section: [
      "### Catalogue",
      "",
      `${nombre(analyse.total)} lieux dans le seed, ${nombre(prod)} en prod (un seed en avance n'est qu'une information tant qu'il n'est pas déployé).`,
      "",
      `Par pays : ${Object.entries(analyse.parPays).map(([p, n]) => `${p} ${nombre(n)}`).join(", ")}.`,
      `Par type : ${Object.entries(analyse.parType).map(([t, n]) => `${t} ${nombre(n)}`).join(", ")}.`,
      "",
      tableau(["Catégorie", "Nombre", "Exemples"], lignes),
    ].join("\n"),
  };
}

async function donneesHistoire(etat, ajouter) {
  const front = path.join(HISTOIRE, "HistorySiteFrontend");
  const lire = (fichier) => readFileSync(path.join(front, "src", "data", fichier), "utf8");
  const api = await obtenir("https://roisempereurs.fr/api/rulers");
  const analyse = analyserHistoire({
    souverains: JSON.parse(api.texte),
    instantane: JSON.parse(lire("rulers-snapshot.json")),
    biosFr: clesObjet(lire("bios.js")),
    biosEn: clesObjet(lire("bios.en.js")),
    datesFr: souverainsCites(lire("keyDates.js")),
    datesEn: souverainsCites(lire("keyDates.en.js")),
    portraits: JSON.parse(lire("portraits.json")),
    fichierExiste: (src) => existsSync(path.join(front, "public", src)),
  });
  const resume = tailles(analyse.anomalies);
  const presentes = Object.entries(analyse.anomalies).filter(([, v]) => v.length);
  const enHausse = hausses(analyse.anomalies, etat.donnees);
  if (enHausse.length) ajouter("attention", `Données en hausse : ${enHausse.map((h) => `${h.cle} ${h.avant} → ${h.apres}`).join(", ")}`);
  else if (!etat.donnees && presentes.length) {
    ajouter("attention", `Données : ${presentes.map(([k, v]) => `${k} ${v.length} (${v.slice(0, 2).join(", ")})`).join(" ; ")}`);
  }
  ajouter("ok", `Souverains : ${analyse.total.prod} en prod, ${analyse.total.local} dans le dépôt`);
  const lignes = Object.entries(analyse.anomalies).map(([cle, v]) => [cle, v.length, v.slice(0, 5).join(", ")]);
  return { resume, section: `### Données\n\n${tableau(["Catégorie", "Nombre", "Exemples"], lignes)}` };
}

/* ----------------------------------------------------------- dependances */

function dependances(c, ajouter) {
  const lignes = [];
  let critiques = 0;

  const audit = JSON.parse(sortieDe("npm.cmd", ["audit", "--json"], c.front) || "{}");
  const v = audit.metadata?.vulnerabilities ?? {};
  critiques += (v.high ?? 0) + (v.critical ?? 0);
  const vulnerables = Object.entries(audit.vulnerabilities ?? {})
    .filter(([, d]) => ["high", "critical"].includes(d.severity))
    .map(([nom, d]) => `${nom} (${d.severity}${d.fixAvailable ? ", correctif dispo" : ""})`);
  lignes.push(["Front : vulnérabilités", `critique ${v.critical ?? 0}, haute ${v.high ?? 0}, moyenne ${v.moderate ?? 0}, basse ${v.low ?? 0}`, vulnerables.join(", ")]);

  const obsoletes = JSON.parse(sortieDe("npm.cmd", ["outdated", "--json"], c.front) || "{}");
  const majeures = Object.entries(obsoletes)
    .filter(([, d]) => d.current && d.latest && d.current.split(".")[0] !== d.latest.split(".")[0])
    .map(([nom, d]) => `${nom} ${d.current} → ${d.latest}`);
  lignes.push(["Front : versions majeures dispo", majeures.length, majeures.join(", ")]);

  const vulnBack = sortieDe("dotnet", ["list", c.back, "package", "--vulnerable", "--include-transitive"], path.dirname(c.back));
  const vulnBackLignes = vulnBack.split(/\r?\n/).filter((l) => /^\s*>/.test(l) && /\b(High|Critical|Moderate|Low)\b/.test(l));
  critiques += vulnBackLignes.filter((l) => /\b(High|Critical)\b/.test(l)).length;
  lignes.push(["Back : vulnérabilités", vulnBackLignes.length, vulnBackLignes.map((l) => l.trim().split(/\s+/).slice(1, 2)).join(", ")]);

  const obsBack = sortieDe("dotnet", ["list", c.back, "package", "--outdated"], path.dirname(c.back));
  const obsBackLignes = obsBack.split(/\r?\n/).filter((l) => /^\s*>/.test(l));
  lignes.push(["Back : paquets à jour dispo", obsBackLignes.length, obsBackLignes.slice(0, 6).map((l) => l.trim().split(/\s+/).slice(1, 2)).join(", ")]);

  if (critiques > 0) ajouter("attention", `Dépendances : ${critiques} vulnérabilité(s) haute(s) ou critique(s)${vulnerables.length ? ` (${vulnerables.slice(0, 3).join(", ")})` : ""}`);
  ajouter("ok", `Dépendances : front ${v.total ?? 0} vulnérabilité(s), ${majeures.length} mise(s) à jour majeure(s) ; back ${vulnBackLignes.length} vulnérabilité(s)`);
  return `### Dépendances\n\n${tableau(["Contrôle", "Résultat", "Détail"], lignes)}`;
}

function tailleBundle(dossier, etat, ajouter) {
  if (!dossier || !existsSync(dossier)) return { section: "", poids: null };
  const fichiers = readdirSync(dossier).map((n) => path.join(dossier, n));
  const plusGros = (ext) => fichiers.filter((f) => f.endsWith(ext)).sort((a, b) => statSync(b).size - statSync(a).size)[0];
  const mesure = (f) => (f ? { brut: statSync(f).size, gzip: gzipSync(readFileSync(f)).length } : null);
  const poids = { js: mesure(plusGros(".js")), css: mesure(plusGros(".css")) };
  const avant = etat.bundle?.js?.gzip;
  if (avant && poids.js && poids.js.gzip > avant * 1.15) ajouter("attention", `Bundle JS : ${ko(avant)} → ${ko(poids.js.gzip)} gzip (+15 %)`);
  return {
    poids,
    section: `Bundle (dist local) : JS ${ko(poids.js?.brut ?? 0)} (${ko(poids.js?.gzip ?? 0)} gzip), CSS ${ko(poids.css?.brut ?? 0)} (${ko(poids.css?.gzip ?? 0)} gzip).`,
  };
}

/* ---------------------------------------------------------------- audit */

export async function executer(controle, { etat }) {
  const c = CONFIGS[controle.config];
  const points = [];
  const ajouter = (niveau, texte) => points.push({ niveau, texte });
  const sections = [];
  const nouvelEtat = { ...etat };

  const etapes = [
    ["performance", async () => {
      const r = await auditPerformance(c, etat, ajouter);
      nouvelEtat.performance = r.mesures;
      sections.push(r.section);
    }],
    ["données", async () => {
      const r = c.donnees === "catalogue" ? await donneesCatalogue(etat, ajouter) : await donneesHistoire(etat, ajouter);
      nouvelEtat.donnees = r.resume;
      sections.push(r.section);
    }],
    ["dépendances", async () => sections.push(dependances(c, ajouter))],
    ["bundle", async () => {
      const r = tailleBundle(c.bundle, etat, ajouter);
      if (r.poids) nouvelEtat.bundle = r.poids;
      if (r.section) sections.push(r.section);
    }],
  ];
  // Une partie qui echoue n'empeche pas les autres : l'audit dit ce qu'il a pu faire
  for (const [nom, etape] of etapes) {
    try {
      await etape();
    } catch (e) {
      ajouter("echec", `Audit ${nom} impossible : ${e.message.split("\n")[0].slice(0, 160)}`);
    }
  }

  const anomalies = points.filter((p) => p.niveau !== "ok");
  const resume = anomalies.length
    ? `${anomalies.length} point(s) à regarder : ${anomalies.map((p) => p.texte).join(" ; ").slice(0, 220)}`
    : "Rien à signaler : performance stable, données cohérentes, aucune vulnérabilité haute ou critique.";
  const sectionJournal = sections.join("\n\n");
  return { points, resume, sectionJournal, detail: sectionJournal, nouvelEtat };
}
