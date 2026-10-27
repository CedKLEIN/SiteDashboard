/**
 * Recupere les derniers commits (git pull --ff-only), compile la version
 * release, l'installe et la relance : `npm.cmd run installer`.
 *
 * Remplace la suite de gestes a la main (build, fermer l'appli, lancer
 * l'installeur, rouvrir). `--sans-build` reinstalle le dernier installeur
 * produit sans recompiler.
 *
 * A lancer depuis un terminal Windows ordinaire. Lance depuis l'appli Claude,
 * l'installeur ecrirait dans l'espace prive de Claude (virtualisation du
 * paquet Store) et l'appli installee ne serait pas celle de Windows.
 */
import { execFileSync, execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const RACINE = path.resolve(import.meta.dirname, "..");
const EXE = "site-dashboard.exe";

/** `==> ` : l'ecran de mise a jour de l'appli y lit l'etape en cours (npm ecrit deja des `> `). */
function etape(message) {
  console.log(`\n==> ${message}`);
}

const { productName, version } = JSON.parse(
  readFileSync(path.join(RACINE, "src-tauri", "tauri.conf.json"), "utf8"),
);
const installeur = path.join(
  RACINE,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "nsis",
  `${productName}_${version}_x64-setup.exe`,
);
const installe = path.join(process.env.LOCALAPPDATA ?? "", productName, EXE);

if (!process.argv.includes("--sans-build")) {
  // Les commits pousses d'ailleurs d'abord. --ff-only : jamais de fusion ;
  // une branche qui a diverge arrete la mise a jour, a regler a la main.
  etape("Récupération des derniers commits");
  execFileSync("git", ["pull", "--ff-only"], { cwd: RACINE, stdio: "inherit" });

  etape("Compilation de la nouvelle version (quelques minutes)");
  // shell: un .cmd ne se lance pas sans shell depuis Node sous Windows
  execSync("npm.cmd run app:build", { cwd: RACINE, stdio: "inherit" });
}

if (!existsSync(installeur)) {
  console.error(`Installeur introuvable : ${installeur}`);
  process.exit(1);
}

etape("Fermeture de l'appli si elle tourne");
try {
  execFileSync("taskkill", ["/IM", EXE], { stdio: "ignore" });
  // L'installeur echoue si l'exe est encore verrouille : on laisse 2 s au
  // processus pour se fermer (`timeout` refuse de tourner sans console).
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
} catch {
  console.log("  (elle ne tournait pas)");
}

etape("Installation de la nouvelle version");
execFileSync(installeur, ["/S"], { stdio: "inherit" });

if (!existsSync(installe)) {
  console.error(`Installation introuvable apres coup : ${installe}`);
  process.exit(1);
}

etape("Relance de l'appli");
spawn(installe, [], { detached: true, stdio: "ignore" }).unref();
console.log(`\nSiteDashboard ${version} installe : ${installe}`);
