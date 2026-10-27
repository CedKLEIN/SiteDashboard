/**
 * Reglages communs des graphes (Recharts) : couleurs par variables CSS, pour
 * suivre le theme clair ou sombre, et montants au format francais.
 */
import { formatMontant } from "./format";

export const STYLE_INFOBULLE = {
  background: "var(--color-surface-2)",
  border: "1px solid var(--color-bord)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--color-texte)",
};

/**
 * Valeurs des graphes (en euros) au format francais : « 830,05 € ». Les sorties
 * sont tracees sous zero mais se lisent en positif ; la marge garde son signe.
 */
export function formatInfobulle(v, nom, item) {
  const n = Number(v);
  const valeur = item?.dataKey === "marge" ? n : Math.abs(n);
  return [formatMontant(Math.round(valeur * 100)), nom];
}

/** Graduations sans decimales, avec separateur de milliers : « 3 000 € ». */
const FORMAT_AXE = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
export const formatAxe = (v) => `${FORMAT_AXE.format(v)} €`;
