import { execute, select } from "../db";
import { creerCheck } from "./supervision";

/* ---------------------------------------------------------------- sites */

export function listerSites() {
  return select("SELECT * FROM sites ORDER BY actif DESC, nom");
}

export async function creerSite({ nom, url, couleur }) {
  const res = await execute("INSERT INTO sites (nom, url, couleur) VALUES ($1, $2, $3)", [
    nom,
    url || null,
    couleur || "#6366f1",
  ]);

  // Un site avec une URL est supervise des sa creation: sans ce check par defaut,
  // il resterait gris sur l'accueil tant qu'on n'a pas pense a en ajouter un.
  if (url) {
    await creerCheck({ siteId: res.lastInsertId, libelle: "Page d'accueil", url });
  }
  return res;
}

export function majSite(id, { nom, url, couleur, actif }) {
  return execute(
    "UPDATE sites SET nom = $1, url = $2, couleur = $3, actif = $4 WHERE id = $5",
    [nom, url || null, couleur, actif ? 1 : 0, id],
  );
}

export function majFaviconSite(id, favicon) {
  return execute("UPDATE sites SET favicon = $1 WHERE id = $2", [favicon, id]);
}

export function supprimerSite(id) {
  return execute("DELETE FROM sites WHERE id = $1", [id]);
}
