/**
 * Chrome pour les agents qui en ont besoin (extension Claude in Chrome, ou mes
 * connexions Search Console et Bing sont ouvertes). Claude Code ne sait pas
 * lancer Chrome : SiteDashboard l'ouvre s'il est ferme, reduit, avec mon profil
 * habituel, puis le referme apres l'agent. Un Chrome deja ouvert n'est pas touche.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

/**
 * Preferences d'un profil Chrome -> les cookies de claude.ai partent-ils a la
 * fermeture ? (reglage « Effacer les cookies et les données des sites quand
 * vous fermez toutes les fenêtres », valeur 4, sans exception qui garde
 * claude.ai). Dans ce cas l'extension perd sa session a chaque redemarrage de
 * Chrome : « session_expired », et plus aucun agent ne l'atteint.
 */
export function cookiesClaudeEffaces(preferences) {
  const exceptions = Object.entries(preferences?.profile?.content_settings?.exceptions?.cookies ?? {}).filter(([motif]) =>
    /(^|[./\]])claude\.ai/.test(motif),
  );
  if (exceptions.some(([, v]) => v?.setting === 1)) return false;
  if (exceptions.some(([, v]) => v?.setting === 4)) return true;
  return preferences?.profile?.default_content_setting_values?.cookies === 4;
}

/** Lit le reglage dans le dernier profil utilise ; false si illisible. */
export function lireCookiesClaudeEffaces(env = process.env) {
  if (!env.LOCALAPPDATA) return false;
  const donnees = path.join(env.LOCALAPPDATA, "Google", "Chrome", "User Data");
  try {
    let profil = "Default";
    try {
      profil = JSON.parse(readFileSync(path.join(donnees, "Local State"), "utf8")).profile?.last_used || profil;
    } catch {
      // Local State illisible : le profil par defaut
    }
    return cookiesClaudeEffaces(JSON.parse(readFileSync(path.join(donnees, profil, "Preferences"), "utf8")));
  } catch {
    return false;
  }
}

/** Temps laisse a Chrome pour se fermer completement. */
export const ATTENTE_FERMETURE_MS = 30_000;

function demanderFermeture() {
  return new Promise((resolve) => {
    execFile("taskkill", ["/IM", "chrome.exe"], { windowsHide: true }, () => resolve());
  });
}

/**
 * Ferme Chrome proprement (sans /F : il enregistre sa session comme a la main)
 * et attend que ses processus aient disparu. taskkill rend la main tout de
 * suite alors que Chrome met quelques secondes a s'arreter : l'agent suivant le
 * croyait « deja ouvert », ne le rouvrait pas, et trouvait l'extension muette.
 * Renvoie true si Chrome est bien ferme.
 */
export async function fermerChrome({ attente = ATTENTE_FERMETURE_MS, pas = 500, tuer = demanderFermeture, ouvert = chromeOuvert } = {}) {
  await tuer();
  for (let ecoule = 0; ecoule < attente; ecoule += pas) {
    if (!(await ouvert())) return true;
    await new Promise((r) => setTimeout(r, pas));
  }
  return !(await ouvert());
}
