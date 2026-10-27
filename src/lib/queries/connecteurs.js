import { select } from "../db";

/** Ecriture deja importee par un connecteur : meme source, meme reference. */
export async function ecritureParRef(table, source, ref) {
  if (table !== "depenses" && table !== "revenus") throw new Error(`table inattendue : ${table}`);
  const [ligne] = await select(`SELECT * FROM ${table} WHERE source = $1 AND ref_externe = $2 LIMIT 1`, [source, ref]);
  return ligne ?? null;
}
