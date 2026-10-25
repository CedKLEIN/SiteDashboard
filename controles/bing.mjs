/**
 * Soumission quotidienne a Bing des URL du sitemap jamais soumises, par l'API
 * officielle de Bing Webmaster (URL Submission API).
 *
 * Reprend la partie Bing de l'agent « Indexation » : URL du sitemap absentes de
 * indexation-bing-soumises.txt, pages hors fiches d'abord (/cols, /collections...)
 * puis les fiches, dans la limite du quota du jour. Chaque URL acceptee est
 * ajoutee au fichier. La partie Google reste a l'agent Claude : Google ne
 * propose aucune API de demande d'indexation pour ces pages.
 *
 * Cle API : %USERPROFILE%\.sitedashboard\bing.json ({"cle": "..."}) ou la
 * variable BING_API_KEY. Elle ne figure jamais dans un rapport ni un message.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { nombre, obtenir, tableau } from "./lib/commun.mjs";
import { locs } from "./sante-prod.mjs";

const API = "https://ssl.bing.com/webmaster/api.svc/json";
const LOT_MAX = 500;
export const FICHIER_CLE = path.join(os.homedir(), ".sitedashboard", "bing.json");

/** Configuration tiree de la fiche du site ; les URL soumises vont dans le fichier de suivi de l'agent. */
export function configBing(controle) {
  const base = controle.fiche.url.replace(/\/$/, "");
  return {
    site: `${base}/`,
    sitemap: controle.fiche.sitemap ?? `${base}/sitemap.xml`,
    soumises: controle.fichierSuivi,
    fiches: controle.fiche.bing?.fiches ?? null,
  };
}

export function lireCle() {
  if (process.env.BING_API_KEY) return process.env.BING_API_KEY.trim();
  try {
    return JSON.parse(readFileSync(FICHIER_CLE, "utf8")).cle?.trim() || null;
  } catch {
    return null;
  }
}

/** Retire la cle d'un message avant de l'afficher. */
function masquer(texte, cle) {
  return cle ? String(texte).split(cle).join("***") : String(texte);
}

/**
 * Les fiches (chemins qui suivent `motif`, ex. ^/catalogs/[^/]+$) passent apres
 * les autres pages, dans l'ordre du sitemap. Sans motif, l'ordre du sitemap.
 */
export function ordonner(urls, motif = null) {
  const regle = motif ? new RegExp(motif) : null;
  const fiche = (u) => Boolean(regle?.test(new URL(u).pathname));
  return [...urls.filter((u) => !fiche(u)), ...urls.filter(fiche)];
}

/** URL du sitemap jamais soumises, dans l'ordre de priorite. */
export function aSoumettre(sitemap, dejaSoumises, motif = null) {
  const deja = new Set(dejaSoumises.map((u) => u.trim()).filter(Boolean));
  return ordonner([...new Set(sitemap)].filter((u) => !deja.has(u)), motif);
}

async function appel(methode, url, cle, corps) {
  const options = {
    method: methode,
    headers: { "content-type": "application/json; charset=utf-8" },
    signal: AbortSignal.timeout(60_000),
  };
  if (corps) options.body = JSON.stringify(corps);
  const reponse = await fetch(`${API}/${url}${url.includes("?") ? "&" : "?"}apikey=${encodeURIComponent(cle)}`, options);
  const texte = await reponse.text();
  if (!reponse.ok) throw new Error(`Bing a répondu ${reponse.status} : ${masquer(texte, cle).slice(0, 200)}`);
  return texte ? JSON.parse(texte) : null;
}

export async function executer(controle, { essai = false } = {}) {
  const c = configBing(controle);
  const points = [];
  const ajouter = (niveau, texte) => points.push({ niveau, texte });

  // URL du sitemap (index ou simple)
  const racine = await obtenir(c.sitemap);
  let urls = locs(racine.texte);
  if (/<sitemapindex/i.test(racine.texte ?? "")) {
    const toutes = [];
    for (const sous of urls) toutes.push(...locs((await obtenir(sous)).texte));
    urls = toutes;
  }
  if (urls.length === 0) {
    ajouter("echec", "Sitemap vide ou illisible : rien à soumettre");
    return { points, resume: "Sitemap illisible, aucune soumission.", sectionJournal: "", detail: "", nouvelEtat: {} };
  }
  const deja = existsSync(c.soumises) ? readFileSync(c.soumises, "utf8").split(/\r?\n/) : [];
  const restantes = aSoumettre(urls, deja, c.fiches);

  const cle = lireCle();
  if (!cle) {
    // Rien a analyser pour Claude : l'action a faire est connue
    points.push({
      niveau: "attention",
      texte: `Clé API Bing absente : crée ${FICHIER_CLE} avec {"cle": "..."} (Bing Webmaster > Paramètres > Accès API)`,
      sansAnalyse: true,
    });
    ajouter("ok", `${nombre(restantes.length)} URL du sitemap encore jamais soumises sur ${nombre(urls.length)}`);
    return {
      points,
      resume: "Soumission Bing impossible : clé API absente.",
      sectionJournal: "",
      detail: `Sitemap : ${urls.length} URL, ${restantes.length} jamais soumises.`,
      nouvelEtat: {},
    };
  }

  let quota = 0;
  let soumises = [];
  try {
    const q = await appel("GET", `GetUrlSubmissionQuota?siteUrl=${encodeURIComponent(c.site)}`, cle);
    quota = q?.d?.DailyQuota ?? 0;
    const lot = restantes.slice(0, quota);
    if (!essai) {
      for (let i = 0; i < lot.length; i += LOT_MAX) {
        const morceau = lot.slice(i, i + LOT_MAX);
        await appel("POST", "SubmitUrlBatch", cle, { siteUrl: c.site, urlList: morceau });
        // Ajoute au fur et a mesure : un echec au lot suivant ne fait pas oublier celles-ci
        appendFileSync(c.soumises, morceau.map((u) => `${u}\n`).join(""), "utf8");
        soumises.push(...morceau);
      }
    } else {
      soumises = lot;
    }
  } catch (e) {
    ajouter("echec", `Soumission Bing en erreur : ${masquer(e.message, cle).slice(0, 200)}`);
  }

  const total = deja.filter((u) => u.trim()).length + (essai ? 0 : soumises.length);
  if (soumises.length) ajouter("ok", `${nombre(soumises.length)} URL soumises à Bing${essai ? " (essai, rien envoyé)" : ""}, ${nombre(total)} au total`);
  else if (restantes.length === 0) ajouter("ok", "Toutes les URL du sitemap ont déjà été soumises");
  else if (quota === 0 && !points.some((p) => p.niveau === "echec")) ajouter("ok", "Quota Bing du jour déjà épuisé");
  ajouter("ok", `Reste ${nombre(Math.max(0, restantes.length - soumises.length))} URL jamais soumises sur ${nombre(urls.length)}`);

  const exemples = soumises.slice(0, 5).map((u) => [u]);
  return {
    points,
    resume: soumises.length
      ? `${nombre(soumises.length)} URL soumises à Bing (quota ${quota}), ${nombre(total)} au total.`
      : points[0].texte,
    sectionJournal: tableau(["Exemples d'URL soumises"], exemples),
    detail: `Sitemap ${urls.length} URL, ${restantes.length} jamais soumises, quota ${quota}, soumises ${soumises.length}.`,
    nouvelEtat: { derniereSoumission: soumises.length, quota },
  };
}
