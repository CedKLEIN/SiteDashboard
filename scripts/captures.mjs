/**
 * Capture chaque ecran du mode apercu en PNG : `npm.cmd run captures -- <prefixe>`.
 *
 * Suppose l'apercu lance (`npm.cmd run apercu`, port 1420). Les images vont dans
 * captures/ (ignore par git), nommees <prefixe>-<ecran>.png.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const RACINE = path.resolve(import.meta.dirname, "..");
const SORTIE = path.join(RACINE, "captures");
const PREFIXE = process.argv[2] ?? "capture";
const URL = process.env.APERCU_URL ?? "http://127.0.0.1:1420/";
const LARGEUR = Number(process.env.LARGEUR ?? 1440);
const HAUTEUR = Number(process.env.HAUTEUR ?? 900);
mkdirSync(SORTIE, { recursive: true });

const ONGLETS = [
  ["accueil", "Vue d'ensemble"],
  ["sites", "Sites"],
  ["finances", "Finances"],
  ["reglages", "Réglages"],
];

const navigateur = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await navigateur.newPage({ viewport: { width: LARGEUR, height: HAUTEUR } });
const erreurs = [];
page.on("pageerror", (e) => erreurs.push(e.message));
page.on("console", (m) => m.type() === "error" && erreurs.push(m.text()));

async function capturer(nom) {
  // Laisse les graphes s'animer et les requetes se terminer
  await page.waitForTimeout(1500);
  // La zone <main> defile a l'interieur d'une page a hauteur d'ecran : on agrandit
  // la fenetre a la hauteur de son contenu pour tout voir, puis on revient.
  const hauteur = await page.evaluate(() => document.querySelector("main")?.scrollHeight ?? 0);
  await page.setViewportSize({ width: LARGEUR, height: Math.max(HAUTEUR, hauteur + 64) });
  await page.waitForTimeout(600);
  const fichier = path.join(SORTIE, `${PREFIXE}-${nom}.png`);
  await page.screenshot({ path: fichier });
  await page.setViewportSize({ width: LARGEUR, height: HAUTEUR });
  console.log(fichier);
}

const onglet = (nom) => page.getByRole("tab", { name: nom, exact: true }).click();

await page.goto(URL, { waitUntil: "networkidle" });
for (const [nom, libelle] of ONGLETS) {
  await page.locator("nav").getByRole("button", { name: libelle, exact: false }).first().click();
  await capturer(nom);
}
await page.locator("nav").getByRole("button", { name: "Finances" }).click();
await onglet("Abonnements");
await capturer("abonnements");
await page.locator("nav").getByRole("button", { name: "Réglages" }).click();
await onglet("Agents");
await capturer("agents");

// Fiche du premier site, onglet par onglet : premiere carte de la page Sites
await page.locator("nav").getByRole("button", { name: "Sites", exact: true }).click();
await page.waitForTimeout(800);
const premier = page.locator("main button").first();
if (await premier.count()) {
  await premier.click();
  await capturer("site-sante");
  for (const [nom, libelle] of [["site-finances", "Finances"], ["site-agents", "Agents"], ["site-reglages", "Réglages"]]) {
    await onglet(libelle);
    await capturer(nom);
  }
}

await navigateur.close();
if (erreurs.length) {
  console.log(`\n${erreurs.length} erreur(s) dans la page :`);
  for (const e of new Set(erreurs)) console.log(`  - ${e}`);
}
