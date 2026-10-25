import { execute, select } from "../db";

/* --------------------------------------------------------- fournisseurs */

export function listerFournisseurs() {
  return select("SELECT * FROM fournisseurs ORDER BY nom");
}

/**
 * Cree le fournisseur s'il n'existe pas, et renvoie son id dans tous les cas.
 * L'URL fournie complete un fournisseur qui n'en avait pas encore, sans jamais
 * ecraser celle deja enregistree.
 */
export async function trouverOuCreerFournisseur(nom, categorie = "autre", url = null) {
  const propre = String(nom || "").trim();
  if (!propre) return null;

  const existant = await select("SELECT id, url FROM fournisseurs WHERE nom = $1", [propre]);
  if (existant.length > 0) {
    if (url && !existant[0].url) {
      await execute("UPDATE fournisseurs SET url = $1 WHERE id = $2", [url, existant[0].id]);
    }
    return existant[0].id;
  }

  const res = await execute(
    "INSERT INTO fournisseurs (nom, categorie, url) VALUES ($1, $2, $3)",
    [propre, categorie, url || null],
  );
  return res.lastInsertId;
}

export function majFaviconFournisseur(id, favicon) {
  return execute("UPDATE fournisseurs SET favicon = $1 WHERE id = $2", [favicon, id]);
}
