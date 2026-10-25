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
  ["dashboard", "Tableau de bord"],
  ["depenses", "Dépenses"],
  ["revenus", "Revenus"],
  ["abonnements", "Abonnements"],
  ["sites", "Sites"],
  ["agents", "Agents"],
  ["preferences", "Préférences"],
];

const navigateur = await chromium.launch();
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
  await page.setViewportSize({ width: LARGEUR, height: Math.max(HAUTEUR, hauteur) });
  await page.waitForTimeout(600);
  const fichier = path.join(SORTIE, `${PREFIXE}-${nom}.png`);
  await page.screenshot({ path: fichier });
  await page.setViewportSize({ width: LARGEUR, height: HAUTEUR });
  console.log(fichier);
}

await page.goto(URL, { waitUntil: "networkidle" });
for (const [nom, libelle] of ONGLETS) {
  await page.locator("nav").getByRole("button", { name: libelle, exact: false }).first().click();
  if (nom === "agents") {
    // Deplie la journee la plus recente pour montrer le detail des rapports
    await page.waitForTimeout(800);
    await page.locator("main button[aria-expanded]").first().click().catch(() => {});
  }
  await capturer(nom);
}

// Fiche d'un site : depuis le tableau de bord, clic sur la premiere carte de site
await page.locator("nav").getByRole("button", { name: "Tableau de bord" }).click();
await page.waitForTimeout(800);
const carte = page.locator("main button[title*=' — ']").first();
if (await carte.count()) {
  await carte.click();
  await capturer("detail-site");
}

await navigateur.close();
if (erreurs.length) {
  console.log(`\n${erreurs.length} erreur(s) dans la page :`);
  for (const e of new Set(erreurs)) console.log(`  - ${e}`);
}
