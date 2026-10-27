/**
 * Import des lignes d'un connecteur en depenses et revenus.
 *
 * Chaque ligne porte une reference (`ref_externe`) et le type du connecteur
 * comme `source` : relancer une synchronisation n'importe rien deux fois. Une
 * ligne deja la dont le montant ou la date a bouge (le cumul du mois en cours)
 * est mise a jour, en gardant les sites auxquels elle a ete rattachee depuis.
 */
import { invoke } from "@tauri-apps/api/core";
import { definition } from "./definitions";
import {
  ajouterDepense,
  ajouterRevenu,
  ecritureParRef,
  ecrirePreference,
  lirePreference,
  listerSites,
  majDepense,
  majRevenu,
  partsDepense,
  partsRevenu,
  trouverOuCreerFournisseur,
} from "../queries";
import { convertirVersReference } from "../conversion";
import { aujourdhuiIso } from "../format";

const CLE_PREFERENCE = "connecteurs";

/** Premiere synchronisation : un an d'historique. */
export const JOURS_PREMIERE_SYNCHRO = 365;
/** Synchronisations suivantes : on repart 40 jours en arriere, pour finir le mois precedent. */
export const JOURS_RECOUVREMENT = 40;
/** Une synchronisation automatique toutes les 6 heures. */
export const INTERVALLE_SYNCHRO_MS = 6 * 3600 * 1000;

export async function lireConnecteurs() {
  try {
    const liste = JSON.parse(await lirePreference(CLE_PREFERENCE, "[]"));
    return Array.isArray(liste) ? liste : [];
  } catch {
    return [];
  }
}

export function ecrireConnecteurs(liste) {
  return ecrirePreference(CLE_PREFERENCE, JSON.stringify(liste));
}

/** Appel reel, par la commande Rust (le front ne peut pas : CORS). */
export async function appelReel({ methode = "GET", url, entetes = [], corps = null }) {
  const reponse = await invoke("appel_api", { methode, url, entetes, corps });
  let json;
  try {
    json = JSON.parse(reponse.corps);
  } catch {
    json = reponse.corps;
  }
  return { statut: reponse.statut, json };
}

function joursAvant(dateIso, jours) {
  const [a, m, j] = dateIso.split("-").map(Number);
  return aujourdhuiIso(new Date(a, m - 1, j - jours));
}

/** Debut de la fenetre a synchroniser. */
export function debutSynchro(config, aujourdhui) {
  if (!config.derniereSync) return joursAvant(aujourdhui, JOURS_PREMIERE_SYNCHRO);
  const derniere = String(config.derniereSync).slice(0, 10);
  return joursAvant(derniere < aujourdhui ? derniere : aujourdhui, JOURS_RECOUVREMENT);
}

/** Jeton frais de la connexion Anthropic par le navigateur (outil ant). */
const jetonAntReel = () => invoke("ant_jeton");

export async function synchroniserConnecteur({
  config,
  secret,
  appel = appelReel,
  aujourdhui = aujourdhuiIso(),
  convertir = convertirVersReference,
  jetonAnt = jetonAntReel,
}) {
  const def = definition(config.type);
  if (!def) throw new Error(`connecteur inconnu : ${config.type}`);
  if (!secret) throw new Error("Clé manquante : renseigne-la dans les réglages du connecteur.");

  const lignes = await def.synchroniser({ secret, depuis: debutSynchro(config, aujourdhui), appel, aujourdhui, jetonAnt });
  const sitesExistants = new Set((await listerSites()).map((s) => s.id));
  const siteIds = (config.siteIds ?? []).filter((id) => sitesExistants.has(id));
  const taux = new Map();
  const fournisseurs = new Map();
  const bilan = { nouvelles: 0, misesAJour: 0, inchangees: 0 };

  for (const ligne of lignes) {
    const table = ligne.sens === "revenu" ? "revenus" : "depenses";
    const existante = await ecritureParRef(table, config.type, ligne.ref);
    if (existante && existante.montant_cents === ligne.montantCents && existante.date === ligne.date) {
      bilan.inchangees += 1;
      continue;
    }

    // Un taux par jour et par devise : 300 paiements du meme jour, un seul appel
    const cle = `${ligne.date}|${ligne.devise}`;
    if (!taux.has(cle)) {
      taux.set(cle, (await convertir({ montantCents: 100_000_000, devise: ligne.devise, date: ligne.date })).taux);
    }
    const t = taux.get(cle);
    const conversion = { taux: t, montantEurCents: Math.round(ligne.montantCents * t) };

    let sites = siteIds;
    if (existante) {
      const parts = await (table === "revenus" ? partsRevenu(existante.id) : partsDepense(existante.id));
      sites = parts.map((p) => p.site_id);
    }
    const commun = {
      siteIds: sites,
      date: ligne.date,
      montantCents: ligne.montantCents,
      devise: ligne.devise,
      ...conversion,
      libelle: ligne.libelle,
    };

    if (table === "revenus") {
      if (existante) await majRevenu(existante.id, commun);
      else await ajouterRevenu({ ...commun, source: config.type, refExterne: ligne.ref });
    } else {
      const nom = ligne.fournisseur ?? def.nom;
      if (!fournisseurs.has(nom)) fournisseurs.set(nom, await trouverOuCreerFournisseur(nom, ligne.categorie ?? "autre"));
      const depense = { ...commun, fournisseurId: fournisseurs.get(nom), categorie: ligne.categorie ?? "autre" };
      if (existante) await majDepense(existante.id, depense);
      else await ajouterDepense({ ...depense, source: config.type, refExterne: ligne.ref });
    }
    bilan[existante ? "misesAJour" : "nouvelles"] += 1;
  }
  return bilan;
}

/** Texte court d'un bilan de synchronisation. */
export function resumeBilan({ nouvelles, misesAJour }) {
  if (!nouvelles && !misesAJour) return "À jour, rien de nouveau";
  return [nouvelles && `${nouvelles} importée(s)`, misesAJour && `${misesAJour} mise(s) à jour`].filter(Boolean).join(", ");
}

const enCours = new Set();

/**
 * Synchronise un connecteur enregistre et note le resultat dans sa config.
 * Un connecteur deja en cours n'est pas relance (synchro auto + clic).
 * Renvoie le resultat, ou null s'il tournait deja.
 */
export async function synchroniserEtEnregistrer(id) {
  if (enCours.has(id)) return null;
  enCours.add(id);
  try {
    const config = (await lireConnecteurs()).find((c) => c.id === id);
    if (!config) return null;
    let resultat;
    try {
      const secrets = await invoke("secrets_connecteurs");
      const bilan = await synchroniserConnecteur({ config, secret: secrets?.[id] });
      resultat = { ok: true, message: resumeBilan(bilan), ...bilan };
    } catch (e) {
      resultat = { ok: false, message: String(e?.message ?? e) };
    }
    // Relu juste avant d'ecrire : une modification faite pendant la synchro est gardee
    const liste = await lireConnecteurs();
    const quand = new Date().toISOString();
    await ecrireConnecteurs(
      liste.map((c) =>
        c.id === id ? { ...c, dernierResultat: { ...resultat, le: quand }, ...(resultat.ok ? { derniereSync: quand } : {}) } : c,
      ),
    );
    return resultat;
  } finally {
    enCours.delete(id);
  }
}

export function estEnCours(id) {
  return enCours.has(id);
}

/** Synchronise les connecteurs actifs dont la derniere synchro date de plus de 6 h. */
export async function synchroniserSiBesoin(maintenant = Date.now()) {
  let changement = false;
  for (const c of await lireConnecteurs()) {
    if (!c.actif) continue;
    const derniere = Date.parse(c.dernierResultat?.le ?? c.derniereSync ?? "");
    if (Number.isFinite(derniere) && maintenant - derniere < INTERVALLE_SYNCHRO_MS) continue;
    const resultat = await synchroniserEtEnregistrer(c.id);
    if (resultat?.nouvelles || resultat?.misesAJour) changement = true;
  }
  return changement;
}
