/**
 * Chrome pour les agents qui en ont besoin (extension Claude in Chrome, ou mes
 * connexions Search Console et Bing sont ouvertes). Claude Code ne sait pas
 * lancer Chrome : SiteDashboard l'ouvre s'il est ferme, reduit, avec mon profil
 * habituel, puis le referme apres l'agent. Un Chrome deja ouvert n'est pas touche.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** Temps laisse a l'extension pour se connecter apres l'ouverture. */
export const ATTENTE_EXTENSION_MS = 20_000;

/** chrome.exe : installation par utilisateur, puis pour tous. */
export function trouverChrome(env = process.env) {
  const candidats = [env.LOCALAPPDATA, env.ProgramFiles, env["ProgramFiles(x86)"]]
    .filter(Boolean)
    .map((racine) => path.join(racine, "Google", "Chrome", "Application", "chrome.exe"));
  return candidats.find((c) => existsSync(c)) ?? null;
}

function tasklist() {
  return new Promise((resolve) => {
    execFile("tasklist", ["/FI", "IMAGENAME eq chrome.exe", "/NH"], { windowsHide: true }, (erreur, sortie) =>
      resolve(erreur ? "" : sortie),
    );
  });
}

/** Sortie de tasklist -> Chrome tourne-t-il ? */
export function chromeDansListe(sortie) {
  return /^chrome\.exe\s/im.test(sortie);
}

export async function chromeOuvert() {
  return chromeDansListe(await tasklist());
}

/**
 * Ouvre Chrome reduit s'il ne tourne pas. Renvoie ce qui s'est passe, pour le
 * journal et pour savoir s'il faudra le refermer.
 */
export async function preparerChrome({ attente = ATTENTE_EXTENSION_MS } = {}) {
  if (await chromeOuvert()) return { ouvertParNous: false, message: "Chrome déjà ouvert" };
  const chrome = trouverChrome();
  if (!chrome) return { ouvertParNous: false, message: "Chrome introuvable : l'agent tourne sans" };
  spawn(chrome, ["--start-minimized"], { detached: true, stdio: "ignore", windowsHide: false }).unref();
  await new Promise((r) => setTimeout(r, attente));
  return { ouvertParNous: true, message: `Chrome ouvert par SiteDashboard (${chrome})` };
}

/** Ferme Chrome proprement (sans /F : il enregistre sa session comme a la main). */
export function fermerChrome() {
  return new Promise((resolve) => {
    execFile("taskkill", ["/IM", "chrome.exe"], { windowsHide: true }, () => resolve());
  });
}
