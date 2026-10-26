/**
 * Audit hebdomadaire, en RAPPORT SEULEMENT : performance de la prod (Playwright,
 * mediane de 3 chargements a froid), coherence des donnees, dependances.
 *
 * Reprend les consignes des agents « Audit hebdo ». Attention en cas de
 * regression de performance (LCP +30 %, octets +20 % sur une semaine), de
 * vulnerabilite haute ou critique, ou d'une categorie d'anomalies de donnees
 * en hausse. Rien n'est modifie : ni code, ni paquet, ni donnee. Une
 * vulnerabilite haute ou critique corrigeable demande la tache « Correctifs de
 * dependances » du site (voir correctifs.mjs), qui, elle, modifie.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { nombre, secondes, tableau } from "./lib/commun.mjs";
import { grave, signatureCorrectifs, vulnerabilites } from "./lib/dependances.mjs";
import { mesurerPerformance } from "./lib/navigateur.mjs";

const EXTENSIONS = path.join(import.meta.dirname, "extensions");

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

/* ----------------------------------------------------------- dependances */

function dependances(c, ajouter) {
  const lignes = [];
  let critiques = 0;

  const audit = JSON.parse(sortieDe("npm.cmd", ["audit", "--json"], c.front) || "{}");
  const v = audit.metadata?.vulnerabilities ?? {};
  critiques += (v.high ?? 0) + (v.critical ?? 0);
  const vulns = vulnerabilites(audit);
  const vulnerables = vulns
    .filter(grave)
    .map((d) => `${d.nom} (${d.gravite}${d.correctif === "compatible" ? ", correctif dispo" : d.correctif === "majeur" ? ", correctif en version majeure" : ""})`);
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
  return {
    section: `### Dépendances\n\n${tableau(["Contrôle", "Résultat", "Détail"], lignes)}`,
    // Lu par lancer.mjs : demande la tache « Correctifs de dependances » du site
    signature: signatureCorrectifs(vulns),
  };
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
  const fiche = controle.fiche;
  const c = { ...fiche.audit, base: fiche.url.replace(/\/$/, "") };
  const points = [];
  const ajouter = (niveau, texte) => points.push({ niveau, texte });
  const sections = [];
  const suites = [];
  const nouvelEtat = { ...etat };

  const etapes = [
    ["performance", async () => {
      const r = await auditPerformance(c, etat, ajouter);
      nouvelEtat.performance = r.mesures;
      sections.push(r.section);
    }],
    // Analyse des donnees propre au site : controles/extensions/<nom>.mjs
    ["données", async () => {
      if (!c.donnees?.extension) return;
      const extension = await import(pathToFileURL(path.join(EXTENSIONS, `${c.donnees.extension}.mjs`)).href);
      const r = await extension.donnees(fiche, etat, ajouter);
      nouvelEtat.donnees = r.resume;
      sections.push(r.section);
    }],
    ["dépendances", async () => {
      if (!c.front || !c.back) return;
      const r = dependances(c, ajouter);
      sections.push(r.section);
      if (r.signature) suites.push({ modele: "correctifs", signature: r.signature });
    }],
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
  return { points, resume, sectionJournal, detail: sectionJournal, nouvelEtat, suites };
}
