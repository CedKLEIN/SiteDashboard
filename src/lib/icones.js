import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

/**
 * Formats acceptes pour une icone importee a la main. La liste est ici et pas
 * dans chaque ecran: elle doit rester alignee avec celle d'`importer_image`
 * cote Rust, qui refuse tout le reste.
 */
const EXTENSIONS = ["png", "jpg", "jpeg", "svg", "gif", "webp", "ico"];

/**
 * Ouvre le selecteur de fichier et renvoie l'image choisie en data URI.
 * Renvoie null si la selection est annulee - ce n'est pas une erreur.
 *
 * Leve si le fichier est refuse (trop lourd, format inconnu): l'appelant
 * affiche le message, qui explique quoi faire.
 */
export async function choisirImageLocale() {
  const chemin = await open({
    multiple: false,
    filters: [{ name: "Image", extensions: EXTENSIONS }],
  });
  if (!chemin) return null;

  return invoke("importer_image", { chemin });
}
