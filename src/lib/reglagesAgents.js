/**
 * Onglet Agents (les reglages des taches), site par site. Fonctions pures : le
 * registre (controles et modeles, voir useControles) arrive deja lu.
 */
import { domaine, rattacherSite } from "./rapportsAgents";

/**
 * Les taches du registre regroupees par site (fiche `siteCle`), avec le nom et
 * la couleur du site du tableau de bord et son statut du jour (`vues`, voir
 * vueParSite). Les sites par nom ; dans un site, l'ordre du registre.
 */
export function groupesParSite(controles = [], sites = [], vues = []) {
  const groupes = new Map();
  for (const c of controles) {
    const cle = c.siteCle ?? c.site;
    if (!groupes.has(cle)) {
      const site = rattacherSite(c.site, sites);
      groupes.set(cle, {
        cle,
        nom: site?.nom ?? c.site,
        domaine: c.site,
        couleur: site?.couleur ?? null,
        vue: vues.find((v) => v.cle === (domaine(c.site) || c.site)) ?? null,
        controles: [],
      });
    }
    groupes.get(cle).controles.push(c);
  }
  return [...groupes.values()].sort((a, b) => a.nom.localeCompare(b.nom));
}

/**
 * Pour aligner les sites : par site, les modeles qu'au moins un autre site
 * utilise et que celui-ci n'a pas, avec les champs qui manquent a sa fiche
 * pour les recevoir. Map siteCle -> [{ id, titre, description, siteCle, manquants }].
 */
export function manquesParSite(controles = [], modeles = []) {
  const parSite = new Map();
  for (const c of controles) {
    const cle = c.siteCle ?? c.site;
    if (!parSite.has(cle)) parSite.set(cle, new Set());
    parSite.get(cle).add(c.modele);
  }
  const resultat = new Map();
  for (const [cle, siens] of parSite) {
    const ailleurs = new Set(
      [...parSite].filter(([autre]) => autre !== cle).flatMap(([, modelesAutre]) => [...modelesAutre]),
    );
    const manques = [];
    for (const modele of modeles) {
      if (!ailleurs.has(modele.id) || siens.has(modele.id)) continue;
      const fiche = modele.sites?.find((s) => s.cle === cle);
      if (!fiche || fiche.deja) continue;
      manques.push({ id: modele.id, titre: modele.titre, description: modele.description, siteCle: cle, manquants: fiche.manquants ?? [] });
    }
    resultat.set(cle, manques);
  }
  return resultat;
}
