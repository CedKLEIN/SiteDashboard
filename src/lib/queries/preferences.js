import { execute, select } from "../db";

/* --------------------------------------------------------- preferences */

export async function lirePreference(cle, defaut = null) {
  const [ligne] = await select("SELECT valeur FROM preferences WHERE cle = $1", [cle]);
  return ligne?.valeur ?? defaut;
}

export function ecrirePreference(cle, valeur) {
  return execute(
    `INSERT INTO preferences (cle, valeur) VALUES ($1, $2)
     ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur`,
    [cle, String(valeur)],
  );
}
