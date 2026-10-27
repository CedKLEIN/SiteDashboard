/**
 * Bing, chaque jour, par l'API officielle de Bing Webmaster : soumission des URL
 * du sitemap jamais soumises (URL Submission API), puis surveillance du site
 * (exploration, codes de reponse, pages dans l'index, sitemaps, trafic).
 *
 * Reprend la partie Bing de l'agent « Indexation » : URL du sitemap absentes de
 * indexation-bing-soumises.txt, pages hors fiches d'abord (/cols, /collections...)
 * puis les fiches, dans la limite du quota du jour. Chaque URL acceptee est
 * ajoutee au fichier. La surveillance remplace l'analyse de Bing Webmaster Tools
 * que faisait l'agent dans Chrome : quand ce controle existe pour un site,
 * l'agent ne va plus sur Bing (voir soumissionBingAuto, lib/registre.mjs). La
 * partie Google reste a l'agent Claude : Google ne propose aucune API de
 * demande d'indexation pour ces pages.
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

/* ------------------------------------------------------------ surveillance */

/** Jours remontes pour l'evolution des pages dans l'index et le trafic. */
export const JOURS_EVOLUTION = 7;
/** Baisse des pages dans l'index, sur JOURS_EVOLUTION, a partir de laquelle on alerte. */
export const BAISSE_INDEX_MAX = 0.02;
/** Part des pages explorees en 4xx ou 5xx le dernier jour, au-dela de laquelle on alerte. */
export const PART_4XX_MAX = 0.1;
export const PART_5XX_MAX = 0.02;
/** Statistiques plus vieilles que ca : Bing ne les met plus a jour. */
export const JOURS_STATS_MAX = 7;
/** Sitemap que Bing n'a pas relu depuis ce nombre de jours. */
export const JOURS_SITEMAP_MAX = 14;

const JOUR_MS = 86_400_000;

/** '/Date(1791676800000)/' (format WCF de l'API Bing) -> Date ; null si illisible. */
export function dateBing(valeur) {
  const ms = /-?\d+/.exec(String(valeur ?? ""));
  return ms ? new Date(Number(ms[0])) : null;
}

/** Date -> '25/10' */
function jourCourt(date) {
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function pourcent(part) {
  return `${Math.round(part * 100)} %`;
}

function parDate(lignes) {
  return (lignes ?? [])
    .map((l) => ({ ...l, date: dateBing(l.Date) }))
    .filter((l) => l.date)
    .sort((a, b) => a.date - b.date);
}

/**
 * Points de surveillance tires des reponses de l'API (fonction pure) :
 * `stats` (GetCrawlStats : une ligne par jour d'exploration), `feeds` (GetFeeds :
 * les sitemaps), `trafic` (GetRankAndTrafficStats). Une reponse absente (appel
 * en erreur) est sautee. Les seuils sont des parts, pas des nombres : un site
 * qui grossit ne doit pas finir en alerte permanente. L'evolution vient de la
 * serie de l'API elle-meme : rien a retenir d'un passage a l'autre.
 */
export function surveillance({ stats = null, feeds = null, trafic = null } = {}, maintenant = new Date()) {
  const points = [];
  const ajouter = (niveau, texte) => points.push({ niveau, texte });
  const resume = {};

  const jours = parDate(stats);
  const dernier = jours.at(-1);
  if (stats && !dernier) ajouter("attention", "Bing ne renvoie aucune statistique d'exploration");
  if (dernier) {
    const age = Math.floor((maintenant - dernier.date) / JOUR_MS);
    if (age > JOURS_STATS_MAX) {
      ajouter("attention", `Statistiques Bing figées : dernière exploration connue le ${jourCourt(dernier.date)} (il y a ${age} jours)`);
    }

    // Reference : le jour le plus recent au moins JOURS_EVOLUTION avant le dernier, sinon le plus ancien
    const limite = dernier.date - JOURS_EVOLUTION * JOUR_MS;
    const reference = jours.findLast((s) => s.date <= limite) ?? jours[0];
    const sur = `en ${Math.round((dernier.date - reference.date) / JOUR_MS)} j`;
    const ecart = dernier.InIndex - reference.InIndex;
    resume.index = dernier.InIndex;
    if (reference !== dernier && -ecart > reference.InIndex * BAISSE_INDEX_MAX) {
      ajouter("attention", `Bing : pages dans l'index en baisse, ${nombre(dernier.InIndex)} (${nombre(ecart)} ${sur})`);
    } else {
      const evolution = reference === dernier ? "" : ` (${ecart >= 0 ? "+" : ""}${nombre(ecart)} ${sur})`;
      ajouter("ok", `Bing : ${nombre(dernier.InIndex)} pages dans l'index${evolution}`);
    }

    // Codes de reponse du dernier jour d'exploration
    const le = `le ${jourCourt(dernier.date)}`;
    const explorees = dernier.CrawledPages ?? 0;
    const en4xx = dernier.Code4xx ?? 0;
    const en5xx = dernier.Code5xx ?? 0;
    if (explorees > 0) {
      const alerte4xx = en4xx / explorees > PART_4XX_MAX;
      const alerte5xx = en5xx / explorees > PART_5XX_MAX;
      if (alerte4xx) {
        ajouter("attention", `Bing : ${pourcent(en4xx / explorees)} des pages explorées ${le} répondent en 4xx (${nombre(en4xx)} sur ${nombre(explorees)})`);
      }
      if (alerte5xx) {
        ajouter("attention", `Bing : ${pourcent(en5xx / explorees)} des pages explorées ${le} répondent en 5xx (${nombre(en5xx)} sur ${nombre(explorees)})`);
      }
      if (!alerte4xx && !alerte5xx) {
        ajouter("ok", `Bing a exploré ${nombre(explorees)} pages ${le} : ${nombre(en4xx)} en 4xx, ${nombre(en5xx)} en 5xx`);
      }
    }
    const reseau = (dernier.DnsFailures ?? 0) + (dernier.ConnectionTimeout ?? 0);
    if (reseau > 0) ajouter("attention", `Bing : ${nombre(reseau)} échec(s) DNS ou délai dépassé ${le}`);
    const bloquees = dernier.BlockedByRobotsTxt ?? 0;
    if (bloquees > (reference.BlockedByRobotsTxt ?? 0)) {
      ajouter("attention", `Bing : ${nombre(bloquees)} pages bloquées par robots.txt ${le} (${nombre(reference.BlockedByRobotsTxt ?? 0)} avant)`);
    }
    if ((dernier.ContainsMalware ?? 0) > 0) {
      ajouter("echec", `Bing signale ${nombre(dernier.ContainsMalware)} page(s) contenant un logiciel malveillant`);
    }
  }

  if (feeds) {
    if (feeds.length === 0) ajouter("attention", "Aucun sitemap déclaré dans Bing Webmaster Tools");
    for (const f of feeds) {
      const lu = dateBing(f.LastCrawled);
      const age = lu ? Math.floor((maintenant - lu) / JOUR_MS) : null;
      if (f.Status && f.Status !== "Success") ajouter("attention", `Sitemap Bing en erreur (${f.Status}) : ${f.Url}`);
      else if (age == null) ajouter("attention", `Bing n'a encore jamais lu le sitemap ${f.Url}`);
      else if (age > JOURS_SITEMAP_MAX) ajouter("attention", `Bing n'a pas relu le sitemap ${f.Url} depuis ${age} jours`);
      else ajouter("ok", `Sitemap Bing lu le ${jourCourt(lu)} : ${nombre(f.UrlCount)} URL`);
    }
  }

  const derniersJours = parDate(trafic).slice(-JOURS_EVOLUTION);
  if (derniersJours.length) {
    const somme = (cle) => derniersJours.reduce((total, t) => total + (t[cle] ?? 0), 0);
    resume.clics = somme("Clicks");
    resume.impressions = somme("Impressions");
    ajouter("ok", `Trafic Bing sur ${derniersJours.length} j : ${nombre(resume.clics)} clics, ${nombre(resume.impressions)} impressions`);
  }

  return { points, resume };
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

  // Surveillance : lecture seule, faite aussi en essai. Un appel en erreur n'empeche pas les autres.
  const reponses = {};
  const erreurs = [];
  await Promise.all(
    [
      ["stats", "GetCrawlStats"],
      ["feeds", "GetFeeds"],
      ["trafic", "GetRankAndTrafficStats"],
    ].map(async ([nom, methode]) => {
      try {
        reponses[nom] = (await appel("GET", `${methode}?siteUrl=${encodeURIComponent(c.site)}`, cle))?.d ?? [];
      } catch (e) {
        erreurs.push(`${methode} : ${masquer(e.message, cle).slice(0, 120)}`);
      }
    }),
  );
  const suivi = surveillance(reponses);

  const total = deja.filter((u) => u.trim()).length + (essai ? 0 : soumises.length);
  if (soumises.length) ajouter("ok", `${nombre(soumises.length)} URL soumises à Bing${essai ? " (essai, rien envoyé)" : ""}, ${nombre(total)} au total`);
  else if (restantes.length === 0) ajouter("ok", "Toutes les URL du sitemap ont déjà été soumises");
  else if (quota === 0 && !points.some((p) => p.niveau === "echec")) ajouter("ok", "Quota Bing du jour déjà épuisé");
  ajouter("ok", `Reste ${nombre(Math.max(0, restantes.length - soumises.length))} URL jamais soumises sur ${nombre(urls.length)}`);
  points.push(...suivi.points);
  if (erreurs.length) {
    // Souvent passager (reseau, API) : le prochain passage le dira, inutile d'appeler Claude
    points.push({ niveau: "attention", texte: `Surveillance Bing incomplète : ${erreurs.join(" ; ")}`, sansAnalyse: true });
  }

  const exemples = soumises.slice(0, 5).map((u) => [u]);
  const soumission = soumises.length
    ? `${nombre(soumises.length)} URL soumises à Bing (quota ${quota}), ${nombre(total)} au total.`
    : `${points[0].texte.replace(/\.$/, "")}.`;
  return {
    points,
    resume: suivi.resume.index == null ? soumission : `${soumission} ${nombre(suivi.resume.index)} pages dans l'index Bing.`,
    sectionJournal: tableau(["Exemples d'URL soumises"], exemples),
    detail: `Sitemap ${urls.length} URL, ${restantes.length} jamais soumises, quota ${quota}, soumises ${soumises.length}.`,
    nouvelEtat: { derniereSoumission: soumises.length, quota, bing: suivi.resume },
  };
}
