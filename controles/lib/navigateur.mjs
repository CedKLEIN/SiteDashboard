/**
 * Chromium sans fenetre (Playwright) : erreurs de console et mesures de
 * performance d'une page. Son User-Agent HeadlessChrome est exclu des
 * statistiques de frequentation des sites.
 */
import { chromium } from "playwright-core";

/**
 * Ouvre chaque page et releve : erreurs de console et de page, requetes /api
 * en 4xx/5xx ou en echec, presence d'un <h1>. Une seule session pour toutes.
 */
export async function inspecterPages(base, chemins) {
  const navigateur = await chromium.launch();
  try {
    const resultats = [];
    for (const chemin of chemins) {
      const page = await navigateur.newPage();
      const erreurs = [];
      const api = [];
      page.on("console", (m) => m.type() === "error" && erreurs.push(m.text().slice(0, 200)));
      page.on("pageerror", (e) => erreurs.push(e.message.slice(0, 200)));
      page.on("response", (r) => {
        if (r.url().includes("/api/") && r.status() >= 400) api.push(`${r.status()} ${new URL(r.url()).pathname}`);
      });
      page.on("requestfailed", (r) => {
        if (r.url().includes("/api/")) api.push(`echec ${new URL(r.url()).pathname} (${r.failure()?.errorText})`);
      });
      let h1 = null;
      let erreurChargement = null;
      try {
        await page.goto(base + chemin, { waitUntil: "networkidle", timeout: 45_000 });
        h1 = (await page.locator("h1").first().textContent({ timeout: 5000 }).catch(() => null))?.trim() ?? null;
      } catch (e) {
        erreurChargement = e.message.split("\n")[0];
      }
      resultats.push({ chemin, erreurs, api, h1, erreurChargement });
      await page.close();
    }
    return resultats;
  } finally {
    await navigateur.close();
  }
}

/** Script injecte avant le chargement : collecte LCP, CLS et taches longues. */
const OBSERVATEURS = () => {
  window.__mesures = { lcp: 0, cls: 0, tbt: 0 };
  new PerformanceObserver((liste) => {
    for (const e of liste.getEntries()) window.__mesures.lcp = e.startTime;
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((liste) => {
    for (const e of liste.getEntries()) if (!e.hadRecentInput) window.__mesures.cls += e.value;
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((liste) => {
    for (const e of liste.getEntries()) window.__mesures.tbt += Math.max(0, e.duration - 50);
  }).observe({ type: "longtask", buffered: true });
};

const mediane = (valeurs) => {
  const tries = [...valeurs].sort((a, b) => a - b);
  return tries[Math.floor(tries.length / 2)];
};

/**
 * Mesure une page `passes` fois en cache froid (nouveau contexte a chaque
 * fois) et renvoie la mediane de chaque indicateur.
 */
export async function mesurerPerformance(url, { passes = 3, pauseMs = 2000 } = {}) {
  const navigateur = await chromium.launch();
  const releves = [];
  try {
    for (let i = 0; i < passes; i += 1) {
      const contexte = await navigateur.newContext();
      const page = await contexte.newPage();
      await page.addInitScript(OBSERVATEURS);
      let requetes = 0;
      let requetesApi = 0;
      const erreurs = [];
      page.on("request", (r) => {
        requetes += 1;
        if (r.url().includes("/api/")) requetesApi += 1;
      });
      page.on("console", (m) => m.type() === "error" && erreurs.push(m.text().slice(0, 160)));
      const debut = Date.now();
      await page.goto(url, { waitUntil: "load", timeout: 60_000 });
      const chargement = Date.now() - debut;
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const mesures = await page.evaluate(() => ({
        ...window.__mesures,
        octets: performance.getEntriesByType("resource").reduce((t, r) => t + (r.transferSize || 0), 0) +
          (performance.getEntriesByType("navigation")[0]?.transferSize || 0),
      }));
      releves.push({ ...mesures, chargement, requetes, requetesApi, erreurs });
      await contexte.close();
      if (i < passes - 1) await new Promise((r) => setTimeout(r, pauseMs));
    }
  } finally {
    await navigateur.close();
  }
  return {
    lcp: Math.round(mediane(releves.map((r) => r.lcp))),
    cls: Number(mediane(releves.map((r) => r.cls)).toFixed(3)),
    tbt: Math.round(mediane(releves.map((r) => r.tbt))),
    chargement: Math.round(mediane(releves.map((r) => r.chargement))),
    requetes: mediane(releves.map((r) => r.requetes)),
    requetesApi: mediane(releves.map((r) => r.requetesApi)),
    octets: Math.round(mediane(releves.map((r) => r.octets))),
    erreurs: [...new Set(releves.flatMap((r) => r.erreurs))],
  };
}
