import { invoke } from "@tauri-apps/api/core";
import { execute, select } from "./db";
import { ecrirePreference, lirePreference } from "./queries";

/**
 * Sauvegardes automatiques de la base, dans Documents\SiteDashboard\sauvegardes.
 *
 * Toutes les donnees vivent dans un seul fichier : une fausse manipulation ou
 * un disque qui lache et tout est perdu. Une copie par semaine, les 8 plus
 * recentes gardees, soit deux mois d'historique pour quelques Mo.
 */
export const JOURS_ENTRE_SAUVEGARDES = 7;
export const SAUVEGARDES_GARDEES = 8;
const CLE = "derniere_sauvegarde";

/** 2026-10-25 14:05 (heure locale) -> '2026-10-25_1405' */
export function horodatage(date) {
  const deux = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}_${deux(
    date.getHours(),
  )}${deux(date.getMinutes())}`;
}

/** Une sauvegarde est due si aucune n'a ete faite, ou la derniere date d'au moins 7 jours. */
export function sauvegardeDue(derniereIso, maintenant = new Date()) {
  const derniere = new Date(derniereIso ?? "");
  if (Number.isNaN(derniere.getTime())) return true;
  return maintenant - derniere >= JOURS_ENTRE_SAUVEGARDES * 86_400_000;
}

/**
 * Ecrit une sauvegarde maintenant et renvoie son chemin.
 *
 * `VACUUM INTO` plutot qu'une copie du fichier : la base est en WAL, et une
 * copie prise pendant une ecriture pourrait etre incoherente ou ignorer les
 * dernieres modifications encore dans le -wal.
 */
export async function sauvegarder(maintenant = new Date()) {
  const chemin = await invoke("chemin_sauvegarde", { horodatage: horodatage(maintenant) });
  await execute("VACUUM INTO $1", [chemin]);
  await ecrirePreference(CLE, maintenant.toISOString());
  await invoke("nettoyer_sauvegardes", { garder: SAUVEGARDES_GARDEES });
  return chemin;
}

/**
 * Classe le resultat de `PRAGMA integrity_check` : 'ok', 'index' (seuls des
 * index sont en defaut : les donnees sont intactes et REINDEX les reconstruit)
 * ou 'grave' (pages ou tables abimees : a restaurer depuis une sauvegarde).
 */
export function analyserIntegrite(messages) {
  if (messages.length === 1 && messages[0] === "ok") return "ok";
  return messages.every((m) => /\bindex\b/.test(m)) ? "index" : "grave";
}

async function integrite() {
  const lignes = await select("PRAGMA integrity_check(100)");
  const messages = lignes.map((l) => Object.values(l)[0]);
  return { etat: analyserIntegrite(messages), messages };
}

/**
 * Controle la base et repare ce qui se repare seul, avant de la sauvegarder.
 *
 * Constate le 25/10/2026 : 22 lignes de l'historique manquaient dans un index,
 * sans que rien ne le montre. Une requete passant par cet index aurait ignore
 * ces lignes. VACUUM INTO recopie un index abime tel quel : la sauvegarde
 * aurait herite du defaut, d'ou le controle juste avant.
 */
export async function verifierEtReparer() {
  const avant = await integrite();
  if (avant.etat !== "index") return avant;
  await execute("REINDEX");
  const apres = await integrite();
  return { ...apres, repare: apres.etat === "ok", avant: avant.messages.length };
}

/**
 * Sauvegarde si la derniere date d'une semaine ou plus, apres controle de la
 * base. Renvoie { chemin, integrite } ou null si rien n'etait du. Une base
 * gravement abimee est quand meme copiee : une copie abimee vaut mieux que pas
 * de copie, et l'appelant previent.
 */
export async function sauvegarderSiBesoin(maintenant = new Date()) {
  if (!sauvegardeDue(await lirePreference(CLE), maintenant)) return null;
  const etat = await verifierEtReparer();
  return { chemin: await sauvegarder(maintenant), integrite: etat };
}

/** Date ISO de la derniere sauvegarde, ou null. */
export function derniereSauvegarde() {
  return lirePreference(CLE);
}
