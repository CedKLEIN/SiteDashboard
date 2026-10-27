import { execute, select } from "../db";

/**
 * Suppression annulable : on photographie la ligne et ses lignes liees (parts
 * par site, tarifs...) avant de la supprimer, pour pouvoir la remettre telle
 * quelle, avec le meme identifiant. Plus besoin de confirmer chaque
 * suppression : une erreur se rattrape d'un clic sur « Annuler ».
 *
 * Les noms de table et de colonne viennent du code et de la base, jamais d'une saisie.
 */
export async function instantane(table, id, liees = []) {
  const [ligne] = await select(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  if (!ligne) return null;
  const enfants = [];
  for (const { table: tableLiee, cle } of liees) {
    const lignes = await select(`SELECT * FROM ${tableLiee} WHERE ${cle} = $1`, [id]);
    enfants.push({ table: tableLiee, lignes });
  }
  return { table, ligne, enfants };
}

async function inserer(table, ligne) {
  const colonnes = Object.keys(ligne);
  await execute(
    `INSERT INTO ${table} (${colonnes.join(", ")}) VALUES (${colonnes.map((_, i) => `$${i + 1}`).join(", ")})`,
    colonnes.map((c) => ligne[c]),
  );
}

/** Remet une ligne photographiee par `instantane`, puis ses lignes liees. */
export async function restaurer(photo) {
  if (!photo) return;
  await inserer(photo.table, photo.ligne);
  for (const { table, lignes } of photo.enfants) {
    for (const ligne of lignes) await inserer(table, ligne);
  }
}

export const LIEES = {
  depenses: [{ table: "depense_sites", cle: "depense_id" }],
  revenus: [{ table: "revenu_sites", cle: "revenu_id" }],
  abonnements: [
    { table: "abonnement_sites", cle: "abonnement_id" },
    { table: "abonnement_tarifs", cle: "abonnement_id" },
  ],
};

/** Photographie puis supprime ; renvoie de quoi annuler. */
export async function supprimerAnnulable(table, id) {
  const liees = LIEES[table] ?? [];
  const photo = await instantane(table, id, liees);
  // Les lignes liees d'abord, explicitement : sans cles etrangeres actives (sql.js
  // de l'apercu), la cascade n'aurait pas lieu et la restauration buterait dessus.
  for (const { table: tableLiee, cle } of liees) {
    await execute(`DELETE FROM ${tableLiee} WHERE ${cle} = $1`, [id]);
  }
  await execute(`DELETE FROM ${table} WHERE id = $1`, [id]);
  return photo;
}
