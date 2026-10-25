/**
 * Sante quotidienne de la prod, en LECTURE SEULE : pages, HTML servi aux
 * robots, API publique, sitemap, certificat, en-tetes, erreurs de console.
 *
 * Reprend les consignes des agents « Santé prod » (Denivio et HistorySite) :
 * echec si une page cle ou l'API est en panne, attention pour une anomalie
 * mineure (lenteur, balise manquante, erreur de console, certificat proche
 * de l'expiration, prod en retard sur le code), ok sinon.
 */
import { execFileSync } from "node:child_process";
import {
  joursCertificat,
  jsonLd,
  liens,
  meta,
  nombre,
  obtenir,
  pause,
  racine,
  secondes,
  tableau,
  texteVisible,
  titre,
} from "./lib/commun.mjs";
import { inspecterPages } from "./lib/navigateur.mjs";

const LENT_MS = 2000;
const SEUIL_CERT_JOURS = 21;

export const CONFIGS = {
  denivio: {
    base: "https://denivio.fr",
    hote: "denivio.fr",
    pages: ["/", "/catalogs", "/catalogs/col-du-galibier", "/catalogs/mont-blanc", "/collections",
      "/collections/les-geants-des-alpes", "/cols", "/cols/isere", "/help", "/legal/mentions-legales",
      "/robots.txt", "/sitemap.xml", "/sitemap-1.xml"],
    absentes: ["/catalogs/ce-lieu-n-existe-pas-xyz", "/catalogs/1790600653-c779de21", "/une-page-inexistante"],
    redirections: [],
    seo: ["/catalogs/col-du-galibier", "/collections/les-geants-des-alpes", "/cols/isere"],
    jsonLdId: "seo-structured-data",
    hreflang: false,
    // Fiches signalees « Soft 404 » par Google : contenu court CONNU (~500 car.),
    // on ne signale qu'un changement net par rapport au passage precedent.
    contenuSurveille: ["/catalogs/pointe-cote-de-l-ane", "/catalogs/col-de-comberon"],
    api: [
      { chemin: "/api/public/stats", verifier: (j) => Object.values(j).some((v) => typeof v === "number" && v > 0) || "aucun nombre non nul" },
      { chemin: "/api/catalog/public/col-du-galibier" },
      { chemin: "/api/catalog/public/map?zoom=9&minLatitude=45&maxLatitude=45.3&minLongitude=6.2&maxLongitude=6.6", verifier: (j) => (j.mode != null && j.total != null) || "mode ou total absent" },
      { chemin: "/api/collection/public/list?pageSize=12", verifier: (j) => j.totalCount != null || "totalCount absent" },
    ],
    cacheControlPublic: true,
    sitemapIndex: true,
    noindex: "/dashboard",
    navigateur: ["/", "/catalogs", "/catalogs/col-du-galibier", "/collections/les-geants-des-alpes"],
  },
  roisempereurs: {
    base: "https://roisempereurs.fr",
    hote: "roisempereurs.fr",
    pages: ["/", "/quiz", "/souverains", "/souverain/louis-xiv", "/souverain/napoleon-ier", "/dynastie/capetiens",
      "/dynastie/bourbons", "/en/souverain/louis-xiv", "/en/souverains", "/robots.txt", "/sitemap.xml", "/version.json"],
    absentes: ["/souverain/ce-souverain-n-existe-pas", "/une-page-inexistante"],
    redirections: [{ chemin: "/en/", statut: 301 }],
    seo: ["/souverain/louis-xiv", "/dynastie/capetiens", "/en/souverain/louis-xiv"],
    jsonLdType: "BreadcrumbList",
    hreflang: true,
    contenuSurveille: [],
    api: [
      {
        chemin: "/api/rulers",
        verifier: (j) => {
          if (!Array.isArray(j) || j.length === 0) return "liste vide";
          // L'API ne sert pas de slug (le front le calcule) : le nom suffit
          const incomplets = j.filter((r) => !r.name).length;
          return incomplets === 0 || `${incomplets} souverain(s) sans nom`;
        },
        compter: (j) => (Array.isArray(j) ? j.length : null),
      },
    ],
    cacheControlPublic: false,
    sitemapIndex: false,
    echantillonSitemap: 5,
    serveurConnu: "nginx/1.18.0 (Ubuntu)",
    version: { chemin: "/version.json", depot: "C:\\Users\\cedao\\Documents\\Projet\\HistorySite\\HistorySiteFrontend" },
    navigateur: ["/", "/souverain/louis-xiv", "/quiz", "/en/souverain/louis-xiv"],
  },
};

/** Les <loc> d'un sitemap. */
export function locs(xml) {
  return [...(xml ?? "").matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
}

/** Controle SEO d'une page servie aux robots : liste des defauts trouves. */
export function defautsSeo(html, url, { titreAccueil, jsonLdId, jsonLdType, hreflang }) {
  const defauts = [];
  const t = titre(html);
  if (!t) defauts.push("title absent");
  else if (titreAccueil && t === titreAccueil) defauts.push("title identique a l'accueil");
  if (!meta(html, "description")) defauts.push("meta description absente");
  const canonique = liens(html, "canonical")[0]?.href;
  if (!canonique) defauts.push("canonical absent");
  else if (canonique.replace(/\/$/, "") !== url.replace(/\/$/, "")) defauts.push(`canonical vers ${canonique}`);
  if (!meta(html, "og:title")) defauts.push("og:title absent");
  if (!/<h1\b/i.test(racine(html))) defauts.push("pas de h1 dans #root");
  const blocs = jsonLd(html);
  if (blocs.some((b) => b.erreur)) defauts.push("JSON-LD invalide");
  if (jsonLdId && !blocs.some((b) => b.id === jsonLdId && !b.erreur)) defauts.push(`JSON-LD #${jsonLdId} absent`);
  if (jsonLdType) {
    const types = blocs.flatMap((b) => [b.donnees?.["@type"], ...(b.donnees?.["@graph"] ?? []).map((g) => g["@type"])]);
    if (!types.includes(jsonLdType)) defauts.push(`JSON-LD ${jsonLdType} absent`);
  }
  if (hreflang) {
    const langues = liens(html, "alternate").map((l) => l.hreflang).filter(Boolean);
    if (!langues.includes("fr") || !langues.includes("en")) defauts.push("hreflang fr/en incomplets");
  }
  return defauts;
}

/** Date ISO du dernier commit d'un depot, ou null. */
function dernierCommit(depot) {
  try {
    const [date, hash, sujet] = execFileSync("git", ["-C", depot, "log", "-1", "--format=%cI%n%h%n%s"], { encoding: "utf8" })
      .trim()
      .split("\n");
    return { date: new Date(date), hash, sujet };
  } catch {
    return null;
  }
}

export async function executer(controle, { etat }) {
  const c = CONFIGS[controle.config];
  const points = [];
  const lignes = [];
  const durees = {};
  const veille = etat.durees ?? {};
  const ajouter = (niveau, texte) => points.push({ niveau, texte });

  // 1. Pages et codes HTTP
  const pagesEnPanne = [];
  const lentes = [];
  for (const chemin of c.pages) {
    const r = await obtenir(c.base + chemin, { corps: false });
    durees[chemin] = r.duree;
    lignes.push([chemin, r.statut ?? r.erreur, secondes(r.duree)]);
    if (r.statut !== 200) pagesEnPanne.push(`${chemin} (${r.statut ?? r.erreur})`);
    else if (r.duree > LENT_MS || (veille[chemin] && r.duree > 2 * veille[chemin] && r.duree > 800)) lentes.push(`${chemin} ${secondes(r.duree)}`);
    await pause(300);
  }
  for (const chemin of c.absentes) {
    const r = await obtenir(c.base + chemin, { corps: false });
    lignes.push([`${chemin} (404 attendu)`, r.statut ?? r.erreur, secondes(r.duree)]);
    if (r.statut !== 404) ajouter("attention", `${chemin} répond ${r.statut ?? r.erreur} au lieu de 404`);
    await pause(300);
  }
  for (const { chemin, statut } of c.redirections) {
    const r = await obtenir(c.base + chemin, { suivre: false, corps: false });
    lignes.push([`${chemin} (${statut} attendu)`, r.statut ?? r.erreur, secondes(r.duree)]);
    if (r.statut !== statut) ajouter("attention", `${chemin} répond ${r.statut ?? r.erreur} au lieu de ${statut}`);
  }
  if (pagesEnPanne.length) ajouter("echec", `Page(s) en erreur : ${pagesEnPanne.join(", ")}`);
  if (lentes.length) ajouter("attention", `Page(s) lente(s) : ${lentes.join(", ")}`);
  const pagesOk = c.pages.length - pagesEnPanne.length;

  // 2. HTML servi aux robots
  const accueil = await obtenir(c.base + "/");
  const titreAccueil = accueil.texte ? titre(accueil.texte) : null;
  const defautsParPage = [];
  for (const chemin of c.seo) {
    const r = await obtenir(c.base + chemin);
    const defauts = r.texte ? defautsSeo(r.texte, c.base + chemin, { titreAccueil, ...c }) : [`page illisible (${r.statut ?? r.erreur})`];
    if (defauts.length) defautsParPage.push(`${chemin} : ${defauts.join(", ")}`);
    await pause(300);
  }
  if (defautsParPage.length) ajouter("attention", `SEO servi aux robots : ${defautsParPage.join(" ; ")}`);
  const contenus = {};
  for (const chemin of c.contenuSurveille) {
    const r = await obtenir(c.base + chemin);
    const longueur = r.texte ? texteVisible(racine(r.texte)).length : 0;
    contenus[chemin] = longueur;
    const avant = etat.contenus?.[chemin];
    if (avant && longueur < avant * 0.7) ajouter("attention", `Contenu de ${chemin} réduit : ${longueur} car. contre ${avant} au passage précédent`);
    await pause(300);
  }

  // 3. API publique
  const apiEnPanne = [];
  const compteurs = {};
  for (const appel of c.api) {
    const r = await obtenir(c.base + appel.chemin);
    let json = null;
    try {
      json = JSON.parse(r.texte ?? "");
    } catch {
      // traite plus bas
    }
    const verdict = r.statut !== 200 ? `HTTP ${r.statut ?? r.erreur}` : !json ? "réponse non JSON" : appel.verifier ? appel.verifier(json) : true;
    if (verdict !== true) apiEnPanne.push(`${appel.chemin.split("?")[0]} : ${verdict}`);
    if (c.cacheControlPublic && r.statut === 200 && !/public/i.test(r.entetes["cache-control"] ?? "")) {
      ajouter("attention", `${appel.chemin.split("?")[0]} sans Cache-Control public`);
    }
    if (appel.compter && json) {
      compteurs[appel.chemin] = appel.compter(json);
      const avant = etat.compteurs?.[appel.chemin];
      if (avant != null && avant !== compteurs[appel.chemin]) {
        ajouter("attention", `${appel.chemin} : ${compteurs[appel.chemin]} éléments contre ${avant} hier`);
      }
    }
    lignes.push([`API ${appel.chemin.split("?")[0]}`, r.statut ?? r.erreur, secondes(r.duree)]);
    await pause(500);
  }
  if (apiEnPanne.length) ajouter("echec", `API en panne : ${apiEnPanne.join(" ; ")}`);

  // 4. Sitemap
  let urlsSitemap = 0;
  let detailSitemap = "";
  const sitemap = await obtenir(c.base + "/sitemap.xml");
  if (c.sitemapIndex) {
    const sous = locs(sitemap.texte);
    for (const url of sous) urlsSitemap += locs((await obtenir(url)).texte).length;
    detailSitemap = `index de ${sous.length} fichier(s), ${nombre(urlsSitemap)} URL`;
  } else {
    const toutes = locs(sitemap.texte);
    urlsSitemap = toutes.length;
    const en = toutes.filter((u) => new URL(u).pathname.startsWith("/en")).length;
    detailSitemap = `${nombre(urlsSitemap)} URL (${nombre(urlsSitemap - en)} FR, ${nombre(en)} EN)`;
    const echantillon = [...toutes].sort(() => Math.random() - 0.5).slice(0, c.echantillonSitemap ?? 0);
    const cassees = [];
    for (const url of echantillon) {
      const r = await obtenir(url, { corps: false });
      if (r.statut !== 200) cassees.push(`${new URL(url).pathname} (${r.statut ?? r.erreur})`);
      await pause(300);
    }
    if (cassees.length) ajouter("echec", `URL du sitemap en erreur : ${cassees.join(", ")}`);
  }
  if (urlsSitemap === 0) ajouter("echec", "Sitemap vide ou illisible");
  else if (etat.urlsSitemap && etat.urlsSitemap !== urlsSitemap) {
    ajouter("attention", `Sitemap : ${nombre(urlsSitemap)} URL contre ${nombre(etat.urlsSitemap)} hier`);
  }

  // 5. Securite et en-tetes
  const cert = await joursCertificat(c.hote);
  if (cert.erreur) ajouter("echec", `Certificat illisible : ${cert.erreur}`);
  else if (cert.jours < SEUIL_CERT_JOURS) ajouter("attention", `Certificat expire dans ${cert.jours} j`);
  const entetes = accueil.entetes;
  const manquants = ["strict-transport-security", "content-security-policy"].filter((e) => !entetes[e]);
  if (manquants.length) ajouter("attention", `En-tête(s) absent(s) sur / : ${manquants.join(", ")}`);
  if (c.serveurConnu && entetes.server && entetes.server !== c.serveurConnu) {
    ajouter("attention", `En-tête Server changé : ${entetes.server} (connu : ${c.serveurConnu})`);
  }
  if (c.noindex) {
    const r = await obtenir(c.base + c.noindex, { corps: false });
    if (!/noindex/i.test(r.entetes["x-robots-tag"] ?? "")) ajouter("attention", `${c.noindex} sans X-Robots-Tag noindex`);
  }
  const http = await obtenir(`http://${c.hote}/`, { suivre: false, corps: false });
  if (http.statut !== 301 || !(http.entetes.location ?? "").startsWith("https://")) {
    ajouter("attention", `http://${c.hote} répond ${http.statut ?? http.erreur} au lieu d'une 301 vers https`);
  }

  // 6. Version deployee contre dernier commit
  let detailVersion = "";
  if (c.version) {
    const v = await obtenir(c.base + c.version.chemin);
    let build = null;
    try {
      build = new Date(JSON.parse(v.texte).buildId);
    } catch {
      // traite plus bas
    }
    const commit = dernierCommit(c.version.depot);
    if (!build || Number.isNaN(build.getTime())) ajouter("attention", `${c.version.chemin} illisible`);
    else if (commit && commit.date > build) {
      ajouter("attention", `Prod en retard : build du ${build.toLocaleDateString("fr-FR")}, dernier commit ${commit.hash} du ${commit.date.toLocaleDateString("fr-FR")} — à redéployer`);
    }
    detailVersion = `build ${build?.toISOString?.() ?? "?"}, dernier commit ${commit?.hash ?? "?"} (${commit?.date?.toISOString?.() ?? "?"})`;
  }

  // 7. Navigateur : erreurs de console et API en erreur
  let detailNavigateur = "";
  try {
    const vues = await inspecterPages(c.base, c.navigateur);
    const problemes = vues.flatMap((v) => [
      ...(v.erreurChargement ? [`${v.chemin} : chargement ${v.erreurChargement}`] : []),
      ...v.erreurs.map((e) => `${v.chemin} : ${e}`),
      ...v.api.map((a) => `${v.chemin} : API ${a}`),
      ...(!v.h1 && !v.erreurChargement ? [`${v.chemin} : aucun h1 affiché`] : []),
    ]);
    if (problemes.length) ajouter("attention", `Navigateur : ${problemes.slice(0, 3).join(" ; ")}${problemes.length > 3 ? ` (+${problemes.length - 3})` : ""}`);
    detailNavigateur = vues.map((v) => `${v.chemin} : h1 « ${v.h1 ?? "—"} », ${v.erreurs.length} erreur(s) console, ${v.api.length} API en erreur`).join("\n");
  } catch (e) {
    ajouter("attention", `Navigateur indisponible : ${e.message.split("\n")[0]}`);
  }

  // Chiffres cles, toujours presents
  ajouter("ok", `${pagesOk}/${c.pages.length} pages en 200, ${c.absentes.length} contrôles 404, toutes sous ${secondes(Math.max(...Object.values(durees)))}`);
  ajouter("ok", `Sitemap : ${detailSitemap}`);
  if (!cert.erreur) ajouter("ok", `Certificat valable jusqu'au ${cert.expire.toLocaleDateString("fr-FR")} (${cert.jours} j)`);
  const compte = Object.values(compteurs)[0];
  if (compte != null) ajouter("ok", `API : ${compte} éléments`);

  const anomalies = points.filter((p) => p.niveau !== "ok");
  const resume = anomalies.length
    ? `${anomalies.length} anomalie(s) : ${anomalies.map((p) => p.texte).join(" ; ").slice(0, 220)}`
    : `Site sain : ${pagesOk} pages en 200, API et sitemap OK, certificat ${cert.jours ?? "?"} j.`;

  const sectionJournal = [
    tableau(["Contrôle", "Résultat", "Temps"], lignes),
    "",
    `**Chiffres clés** : sitemap ${detailSitemap} ; certificat ${cert.erreur ?? `${cert.jours} j`}${detailVersion ? ` ; ${detailVersion}` : ""}.`,
    anomalies.length ? `\n**Anomalies**\n${anomalies.map((p) => `- (${p.niveau}) ${p.texte}`).join("\n")}` : "",
  ].join("\n");

  return {
    points,
    resume,
    sectionJournal,
    detail: [sectionJournal, detailNavigateur && `\nNavigateur :\n${detailNavigateur}`].join("\n"),
    nouvelEtat: { durees, contenus, compteurs, urlsSitemap },
  };
}
