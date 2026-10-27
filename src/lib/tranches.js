/**
 * Barres de disponibilite : on complete les tranches sans verification (appli
 * fermee) pour que chaque barre garde sa place dans le temps.
 */

function deuxChiffres(n) {
  return String(n).padStart(2, "0");
}

/** 'YYYY-MM-DD HH' (ou 'YYYY-MM-DD' au jour) en heure locale, comme SQLite en 'localtime'. */
export function cleTranche(date, parJour = false) {
  const jour = `${date.getFullYear()}-${deuxChiffres(date.getMonth() + 1)}-${deuxChiffres(date.getDate())}`;
  return parJour ? jour : `${jour} ${deuxChiffres(date.getHours())}`;
}

/**
 * Les `n` dernieres tranches, de la plus ancienne a l'actuelle, remplies avec
 * les lignes de `disponibiliteParTranche` d'un site : [{ debut, total, ok, libelle }].
 */
export function tranchesCompletes(lignes, { n = 24, parJour = false, maintenant = new Date() } = {}) {
  const parCle = new Map(lignes.map((l) => [l.tranche, l]));
  const tranches = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(maintenant);
    if (parJour) d.setDate(d.getDate() - i);
    else d.setHours(d.getHours() - i);
    const cle = cleTranche(d, parJour);
    const ligne = parCle.get(cle);
    const total = ligne?.total ?? 0;
    const ok = ligne?.ok ?? 0;
    const quand = parJour
      ? d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
      : `${deuxChiffres(d.getHours())} h`;
    const taux = total > 0 ? `${String(Math.round((ok / total) * 1000) / 10).replace(".", ",")} %` : "aucune vérification";
    tranches.push({ debut: cle, total, ok, libelle: `${quand} : ${taux}` });
  }
  return tranches;
}

/** Taux global d'une liste de tranches, en pourcentage ; null sans verification. */
export function tauxTranches(tranches) {
  const total = tranches.reduce((t, x) => t + x.total, 0);
  if (total === 0) return null;
  return (tranches.reduce((t, x) => t + x.ok, 0) / total) * 100;
}

/** '99,98 %' ; '100 %' sans decimale ; '—' sans donnee. */
export function formatTaux(taux) {
  if (taux == null) return "—";
  if (taux === 100) return "100 %";
  return `${(Math.floor(taux * 100) / 100).toFixed(2).replace(".", ",")} %`;
}

/** Centile (0-100) d'une liste de nombres ; null si vide. */
export function centile(valeurs, p) {
  if (valeurs.length === 0) return null;
  const tries = [...valeurs].sort((a, b) => a - b);
  const rang = Math.min(tries.length - 1, Math.max(0, Math.ceil((p / 100) * tries.length) - 1));
  return tries[rang];
}

/**
 * Latence par demi-heure : mediane et 95e centile des verifications reussies.
 * Une courbe par verification brute est illisible (une pointe par minute).
 */
export function latenceParDemiHeure(historique) {
  const groupes = new Map();
  for (const v of historique) {
    if (!v.ok || v.latence_ms == null) continue;
    const h = String(v.verifie_le).slice(11, 16);
    const cle = `${h.slice(0, 2)}:${Number(h.slice(3, 5)) < 30 ? "00" : "30"}`;
    const jour = String(v.verifie_le).slice(0, 10);
    const id = `${jour} ${cle}`;
    if (!groupes.has(id)) groupes.set(id, { heure: cle, valeurs: [] });
    groupes.get(id).valeurs.push(v.latence_ms);
  }
  return [...groupes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, g]) => ({ heure: g.heure, p50: centile(g.valeurs, 50), p95: centile(g.valeurs, 95) }));
}
