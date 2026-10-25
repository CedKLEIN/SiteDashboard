/**
 * Extension « donnees » de l'audit hebdomadaire pour un catalogue de lieux
 * (Denivio) : anomalies du seed, et nombre de lieux en prod.
 * Fiche du site : audit.donnees.seed (chemin du seed JSON).
 */
import { readFileSync } from "node:fs";
import { nombre, obtenir, tableau } from "../lib/commun.mjs";
import { analyserCatalogue, hausses, tailles } from "../lib/donnees.mjs";

export async function donnees(fiche, etat, ajouter) {
  const analyse = analyserCatalogue(JSON.parse(readFileSync(fiche.audit.donnees.seed, "utf8")));
  const stats = await obtenir(`${fiche.url.replace(/\/$/, "")}/api/public/stats`);
  let prod = null;
  try {
    prod = JSON.parse(stats.texte).catalogCount;
  } catch {
    // stats indisponibles : simple information
  }
  const resume = tailles(analyse.anomalies);
  // horsEurope (outre-mer) grandit avec le seed : une information, pas une derive
  const { horsEurope: _horsEurope, ...surveillees } = analyse.anomalies;
  const enHausse = hausses(surveillees, etat.donnees);
  // Premier passage : seules les anomalies qui empechent d'afficher un lieu comptent
  const critiques = ["coordonneesManquantes", "altitudeHorsBornes", "paysVide"].filter((k) => resume[k] > 0);
  if (enHausse.length) ajouter("attention", `Données en hausse : ${enHausse.map((h) => `${h.cle} ${h.avant} → ${h.apres}`).join(", ")}`);
  else if (!etat.donnees && critiques.length) ajouter("attention", `Données : ${critiques.map((k) => `${k} ${resume[k]}`).join(", ")}`);
  ajouter("ok", `Catalogue : ${nombre(analyse.total)} lieux dans le seed, ${nombre(prod)} en prod`);
  const lignes = Object.entries(analyse.anomalies).map(([cle, v]) => [cle, v.nombre, v.exemples.slice(0, 3).join(" ; ")]);
  return {
    resume,
    section: [
      "### Catalogue",
      "",
      `${nombre(analyse.total)} lieux dans le seed, ${nombre(prod)} en prod (un seed en avance n'est qu'une information tant qu'il n'est pas déployé).`,
      "",
      `Par pays : ${Object.entries(analyse.parPays).map(([p, n]) => `${p} ${nombre(n)}`).join(", ")}.`,
      `Par type : ${Object.entries(analyse.parType).map(([t, n]) => `${t} ${nombre(n)}`).join(", ")}.`,
      "",
      tableau(["Catégorie", "Nombre", "Exemples"], lignes),
    ].join("\n"),
  };
}
