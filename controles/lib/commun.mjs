/**
 * Outils partages par les controles : requetes chronometrees, certificat,
 * lecture de HTML, etat entre deux passages, rapport et journal.
 *
 * Les controles remplacent des agents Claude qui faisaient surtout du travail
 * mecanique. Ils ecrivent le MEME rapport JSON que ces agents, au meme endroit :
 * l'onglet Agents de SiteDashboard, les notifications et l'historique n'y
 * voient aucune difference.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";

export const RACINE_RAPPORTS = path.join(os.homedir(), ".claude", "rapports-agents");
const FICHIER_ETAT = path.join(RACINE_RAPPORTS, ".controles", "etat.json");
export const AGENT_HTTP = "SiteDashboard-controles/1.0";
const DELAI_MS = 20_000;

/* ------------------------------------------------------------------ dates */

const deux = (n) => String(n).padStart(2, "0");

/** Date locale 'AAAA-MM-JJ'. */
export function jourLocal(date = new Date()) {
  return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}`;
}

/** '2026-10-25T09:53:51+01:00' : ISO 8601 en heure locale avec son decalage. */
export function isoLocal(date = new Date()) {
  const decalage = -date.getTimezoneOffset();
  const signe = decalage >= 0 ? "+" : "-";
  const absolu = Math.abs(decalage);
  return (
    `${jourLocal(date)}T${deux(date.getHours())}:${deux(date.getMinutes())}:${deux(date.getSeconds())}` +
    `${signe}${deux(Math.floor(absolu / 60))}:${deux(absolu % 60)}`
  );
}

/** '25/10/2026' */
export function jourFr(date = new Date()) {
  return `${deux(date.getDate())}/${deux(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/* --------------------------------------------------------------- reseau */

/**
 * GET chronometre. Ne rejette jamais : une erreur reseau est un resultat.
 * `suivre: false` garde la redirection visible (statut 30x et Location).
 */
export async function obtenir(url, { suivre = true, corps = true, entetes = {} } = {}) {
  const debut = performance.now();
  try {
    const reponse = await fetch(url, {
      redirect: suivre ? "follow" : "manual",
      headers: { "user-agent": AGENT_HTTP, ...entetes },
      signal: AbortSignal.timeout(DELAI_MS),
    });
    const texte = corps ? await reponse.text() : null;
    return {
      url,
      statut: reponse.status,
      duree: Math.round(performance.now() - debut),
      entetes: Object.fromEntries(reponse.headers),
      texte,
    };
  } catch (e) {
    return { url, statut: null, duree: Math.round(performance.now() - debut), entetes: {}, texte: null, erreur: e.message };
  }
}

/** Jours restants avant l'expiration du certificat presente par un hote. */
export function joursCertificat(hote) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: hote, port: 443, servername: hote, timeout: DELAI_MS }, () => {
      const certificat = socket.getPeerCertificate();
      socket.end();
      const expire = new Date(certificat.valid_to);
      resolve({ expire, jours: Math.floor((expire - Date.now()) / 86_400_000) });
    });
    socket.on("error", (e) => resolve({ erreur: e.message }));
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ erreur: "delai depasse" });
    });
  });
}

/** Pause entre deux requetes : les API publiques des sites sont limitees en debit. */
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------------------------------------------- HTML */

/** Valeur d'une balise <meta name|property="..."> ou null. */
export function meta(html, nom) {
  const balises = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const balise of balises) {
    const cle = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(balise)?.[1];
    if (cle?.toLowerCase() === nom.toLowerCase()) {
      return /\bcontent\s*=\s*["']([^"']*)["']/i.exec(balise)?.[1] ?? "";
    }
  }
  return null;
}

/** href du <link rel="..."> (le premier), ou tous avec `tous`. */
export function liens(html, rel) {
  return (html.match(/<link\b[^>]*>/gi) ?? [])
    .filter((b) => new RegExp(`\\brel\\s*=\\s*["'][^"']*\\b${rel}\\b`, "i").test(b))
    .map((b) => ({
      href: /\bhref\s*=\s*["']([^"']*)["']/i.exec(b)?.[1] ?? null,
      hreflang: /\bhreflang\s*=\s*["']([^"']*)["']/i.exec(b)?.[1] ?? null,
    }));
}

export function titre(html) {
  return /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1].trim() ?? null;
}

/** Contenu de <div id="root"> (approximatif : jusqu'a la fin du body). */
export function racine(html) {
  const debut = html.search(/<div[^>]*\bid\s*=\s*["']root["'][^>]*>/i);
  if (debut === -1) return "";
  const fin = html.search(/<\/body>/i);
  return html.slice(debut, fin === -1 ? undefined : fin);
}

/** Texte visible approximatif d'un fragment HTML (balises et scripts retires). */
export function texteVisible(fragment) {
  return fragment
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Blocs JSON-LD : [{ id, donnees | erreur }]. */
export function jsonLd(html) {
  const blocs = [...html.matchAll(/<script\b([^>]*type\s*=\s*["']application\/ld\+json["'][^>]*)>([\s\S]*?)<\/script>/gi)];
  return blocs.map(([, attributs, contenu]) => {
    const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(attributs)?.[1] ?? null;
    try {
      return { id, donnees: JSON.parse(contenu) };
    } catch (e) {
      return { id, erreur: e.message };
    }
  });
}

/* ------------------------------------------------------------------ etat */

/** Etat persistant d'un controle : mesures de la veille, derniere analyse Claude... */
export function lireEtat(id) {
  try {
    return JSON.parse(readFileSync(FICHIER_ETAT, "utf8"))[id] ?? {};
  } catch {
    return {};
  }
}

export function ecrireEtat(id, etat) {
  let tout = {};
  try {
    tout = JSON.parse(readFileSync(FICHIER_ETAT, "utf8"));
  } catch {
    // premier passage
  }
  tout[id] = etat;
  mkdirSync(path.dirname(FICHIER_ETAT), { recursive: true });
  writeFileSync(FICHIER_ETAT, JSON.stringify(tout, null, 2), "utf8");
}

/* ------------------------------------------------------- verdict, rapport */

const RANG = { ok: 0, attention: 1, echec: 2 };

/** Statut global : le pire des points. */
export function statutGlobal(points) {
  return points.reduce((pire, p) => (RANG[p.niveau] > RANG[pire] ? p.niveau : pire), "ok");
}

/**
 * Empreinte des anomalies (points non ok), sans les nombres : 0,41 s ou 0,38 s
 * ne doivent pas faire passer une meme anomalie pour une nouvelle.
 */
export function empreinte(points) {
  return points
    .filter((p) => p.niveau !== "ok")
    .map((p) => `${p.niveau}:${p.texte.replace(/[\d.,]+/g, "#")}`)
    .sort()
    .join("|");
}

/**
 * Garde au plus `max` points pour le rapport : les anomalies d'abord (les plus
 * graves en tete), puis les chiffres cles. Le detail complet va au journal.
 */
export function pointsDuRapport(points, max = 6) {
  return [...points]
    .sort((a, b) => RANG[b.niveau] - RANG[a.niveau])
    .slice(0, max)
    .map(({ niveau, texte }) => ({ niveau, texte }));
}

export function cheminRapport(site, agent, date = new Date()) {
  return path.join(RACINE_RAPPORTS, site, jourLocal(date), `${agent}.json`);
}

export function ecrireRapport(rapport) {
  const chemin = cheminRapport(rapport.site, rapport.agent, new Date(rapport.debut));
  mkdirSync(path.dirname(chemin), { recursive: true });
  const texte = JSON.stringify(rapport, null, 2);
  JSON.parse(texte); // jamais de rapport invalide sur le disque
  writeFileSync(chemin, texte, "utf8");
  return chemin;
}

/** Ajoute une section au journal de suivi (Markdown), en creant le fichier si besoin. */
export function journaliser(fichier, titreFichier, section) {
  if (!fichier) return;
  if (!existsSync(fichier)) writeFileSync(fichier, `# ${titreFichier}\n`, "utf8");
  appendFileSync(fichier, `\n${section.trim()}\n`, "utf8");
}

/** Tableau Markdown compact. */
export function tableau(entetes, lignes) {
  const echapper = (v) => String(v ?? "—").replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `| ${entetes.join(" | ")} |`,
    `| ${entetes.map(() => "---").join(" | ")} |`,
    ...lignes.map((l) => `| ${l.map(echapper).join(" | ")} |`),
  ].join("\n");
}

/** 412 -> '0,41 s' */
export function secondes(ms) {
  return ms == null ? "—" : `${(ms / 1000).toFixed(2).replace(".", ",")} s`;
}

/** 143030 -> '143 030' (espace fine insecable des nombres francais) */
export function nombre(n) {
  return n == null ? "—" : Number(n).toLocaleString("fr-FR").replace(/ /g, " ");
}
