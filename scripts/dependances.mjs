/**
 * Installe les dependances npm quand package-lock.json a change depuis la
 * derniere installation, avant de compiler (`npm run app:build`).
 *
 * La mise a jour depuis l'appli fait `git pull` puis compile : un commit qui
 * ajoutait un paquet (la police Inter) faisait echouer la compilation, faute
 * de `npm install`. On note l'empreinte du package-lock installe dans
 * node_modules ; differente ou absente, on reinstalle.
 *
 * `npm ci` et non `npm install` : il ne reecrit jamais package-lock.json, qui
 * resterait sinon modifie et bloquerait le prochain `git pull --ff-only`.
 * `--legacy-peer-deps` : voir le README (bug de npm 10.9 sur les peer deps).
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const RACINE = path.resolve(import.meta.dirname, "..");
const MARQUE = path.join(RACINE, "node_modules", ".sitedashboard-dependances");

const empreinte = createHash("sha256").update(readFileSync(path.join(RACINE, "package-lock.json"))).digest("hex");
const installee = existsSync(MARQUE) ? readFileSync(MARQUE, "utf8").trim() : null;

if (installee === empreinte) {
  console.log("Dépendances à jour.");
} else {
  // `==> ` : l'ecran de mise a jour de l'appli y lit l'etape en cours
  console.log("\n==> Installation des dépendances (package-lock.json a changé)");
  execSync("npm ci --legacy-peer-deps --no-audit --no-fund", { cwd: RACINE, stdio: "inherit" });
  writeFileSync(MARQUE, empreinte);
}
