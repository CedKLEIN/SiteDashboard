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

/**
 * Fichiers que la compilation reecrit parfois sur ce PC : Cargo.lock selon la
 * version de cargo, package-lock.json selon celle de npm, et Cargo.toml, dont
 * la CLI Tauri reformate les « features » de tauri. On n'y touche jamais a la
 * main ici (le code arrive par des commits) : modifies localement, ils
 * bloquaient « git pull --ff-only » des qu'un commit les changeait aussi. On
 * les remet tels que commites avant le pull, et apres la compilation.
 */
const GENERES = ["src-tauri/Cargo.lock", "src-tauri/Cargo.toml", "package-lock.json"];

function preparerDepot() {
  const modifies = execFileSync("git", ["status", "--porcelain"], { cwd: RACINE, encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
  if (modifies.length === 0) return;
  console.log("État du dépôt avant récupération :");
  for (const ligne of modifies) console.log(`  ${ligne}`);
  const generes = modifies.map((l) => l.slice(3).trim()).filter((f) => GENERES.includes(f));
  if (generes.length) {
    // La difference d'abord, dans le journal : pour savoir ce que l'outil a reecrit
    console.log(execFileSync("git", ["diff", "--", ...generes], { cwd: RACINE, encoding: "utf8" }).slice(0, 4000));
    console.log(`Fichiers générés remis tels que commités : ${generes.join(", ")}`);
    execFileSync("git", ["checkout", "--", ...generes], { cwd: RACINE, stdio: "inherit" });
  }
}

if (!process.argv.includes("--sans-build")) {
  // Les commits pousses d'ailleurs d'abord. --ff-only : jamais de fusion ;
  // une branche qui a diverge arrete la mise a jour, a regler a la main.
  etape("Récupération des derniers commits");
  preparerDepot();
  try {
    execFileSync("git", ["pull", "--ff-only"], { cwd: RACINE, stdio: "inherit" });
  } catch (e) {
    console.error(
      "\nÉchec de « git pull --ff-only ». Causes possibles : un fichier modifié sur ce PC que les nouveaux commits\n" +
        "changent aussi (voir « git status » ci-dessus), ou une branche locale qui a divergé du dépôt.",
    );
    throw e;
  }

  etape("Compilation de la nouvelle version (quelques minutes)");
  // shell: un .cmd ne se lance pas sans shell depuis Node sous Windows
  execSync("npm.cmd run app:build", { cwd: RACINE, stdio: "inherit" });
  // Depot laisse propre : la prochaine mise a jour ne butera pas sur ces fichiers
  preparerDepot();
}

if (!existsSync(installeur)) {
  console.error(`Installeur introuvable : ${installeur}`);
  process.exit(1);
}

etape("Fermeture de l'appli si elle tourne");
try {
  // /F : fermer la fenetre ne quitte plus l'appli (elle reste dans la barre des taches)
  execFileSync("taskkill", ["/F", "/IM", EXE], { stdio: "ignore" });
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
