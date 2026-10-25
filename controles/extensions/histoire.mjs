/**
 * Extension « donnees » de l'audit hebdomadaire pour le site d'histoire
 * (roisempereurs.fr) : souverains de l'API contre les donnees du front
 * (instantane, bios, dates cles, portraits). Fiche du site : audit.front.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { obtenir, tableau } from "../lib/commun.mjs";
import { analyserHistoire, clesObjet, hausses, souverainsCites, tailles } from "../lib/donnees.mjs";

export async function donnees(fiche, etat, ajouter) {
  const front = fiche.audit.front;
  const lire = (fichier) => readFileSync(path.join(front, "src", "data", fichier), "utf8");
  const api = await obtenir(`${fiche.url.replace(/\/$/, "")}/api/rulers`);
  const analyse = analyserHistoire({
    souverains: JSON.parse(api.texte),
    instantane: JSON.parse(lire("rulers-snapshot.json")),
    biosFr: clesObjet(lire("bios.js")),
    biosEn: clesObjet(lire("bios.en.js")),
    datesFr: souverainsCites(lire("keyDates.js")),
    datesEn: souverainsCites(lire("keyDates.en.js")),
    portraits: JSON.parse(lire("portraits.json")),
    fichierExiste: (src) => existsSync(path.join(front, "public", src)),
  });
  const resume = tailles(analyse.anomalies);
  const presentes = Object.entries(analyse.anomalies).filter(([, v]) => v.length);
  const enHausse = hausses(analyse.anomalies, etat.donnees);
  if (enHausse.length) ajouter("attention", `Données en hausse : ${enHausse.map((h) => `${h.cle} ${h.avant} → ${h.apres}`).join(", ")}`);
  else if (!etat.donnees && presentes.length) {
    ajouter("attention", `Données : ${presentes.map(([k, v]) => `${k} ${v.length} (${v.slice(0, 2).join(", ")})`).join(" ; ")}`);
  }
  ajouter("ok", `Souverains : ${analyse.total.prod} en prod, ${analyse.total.local} dans le dépôt`);
  const lignes = Object.entries(analyse.anomalies).map(([cle, v]) => [cle, v.length, v.slice(0, 5).join(", ")]);
  return { resume, section: `### Données\n\n${tableau(["Catégorie", "Nombre", "Exemples"], lignes)}` };
}
