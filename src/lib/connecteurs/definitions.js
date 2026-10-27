/**
 * Les connecteurs : ce qu'ils demandent (cles), comment ils interrogent leur
 * API, et ce qu'ils en tirent — des lignes d'ecriture pretes a importer :
 *
 *   { sens: "revenu" | "depense", ref, date, montantCents, devise, libelle,
 *     fournisseur?, categorie?, cumul? }
 *
 * Aucune ecriture en base ici (voir moteur.js), et le reseau est injecte :
 * `appel({ methode, url, entetes })` -> { statut, json }. Tout se teste sans reseau.
 *
 * Les couts d'API (Anthropic, OpenAI) arrivent par jour : on les cumule PAR
 * MOIS, une depense par mois mise a jour a chaque synchronisation. Une ligne par
 * jour noierait les vraies depenses dans l'historique.
 */

/** Date locale ISO d'un horodatage Unix en secondes. */
export function dateDepuisUnix(secondes) {
  const d = new Date(secondes * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** '2026-10' -> 'octobre 2026' */
export function moisEnLettres(mois) {
  const [a, m] = mois.split("-").map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

/** Date d'une ecriture mensuelle : le dernier jour du mois, ou aujourd'hui pour le mois en cours. */
export function dateDuMois(mois, aujourdhui) {
  const [a, m] = mois.split("-").map(Number);
  const fin = `${mois}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
  return fin > aujourdhui ? aujourdhui : fin;
}

/** Cumule des montants journaliers { jour, cents } en une ligne par mois. */
export function cumulParMois(jours, { prefixe, libelle, devise, aujourdhui, fournisseur, categorie }) {
  const parMois = new Map();
  for (const { jour, cents } of jours) {
    const mois = jour.slice(0, 7);
    parMois.set(mois, (parMois.get(mois) ?? 0) + cents);
  }
  return [...parMois.entries()]
    .filter(([, cents]) => Math.round(cents) > 0)
    .map(([mois, cents]) => ({
      sens: "depense",
      ref: `${prefixe}-${mois}`,
      date: dateDuMois(mois, aujourdhui),
      montantCents: Math.round(cents),
      devise,
      libelle: `${libelle} — ${moisEnLettres(mois)}`,
      fournisseur,
      categorie,
      cumul: true,
    }));
}

/** Leve une erreur lisible pour une reponse d'API en echec. */
function verifier(reponse, service) {
  if (reponse.statut >= 200 && reponse.statut < 300) return reponse.json;
  const message =
    reponse.json?.error?.message ?? reponse.json?.message ?? reponse.json?.error ?? `HTTP ${reponse.statut}`;
  if (reponse.statut === 401 || reponse.statut === 403) {
    throw new Error(`${service} refuse la clé (${message}). Vérifie qu'elle est valide et a les bons droits.`);
  }
  throw new Error(`${service} : ${typeof message === "string" ? message : JSON.stringify(message)}`);
}

/* ------------------------------------------------------------------ Stripe */

const TYPES_PAIEMENT = new Set(["charge", "payment"]);
const TYPES_REMBOURSEMENT = new Set(["refund", "payment_refund"]);

async function synchroniserStripe({ secret, depuis, appel, aujourdhui }) {
  const lignes = [];
  const frais = [];
  let apres = null;
  for (let page = 0; page < 50; page += 1) {
    const params = new URLSearchParams({ limit: "100", "created[gte]": String(Math.floor(new Date(`${depuis}T00:00:00`).getTime() / 1000)) });
    if (apres) params.set("starting_after", apres);
    const json = verifier(
      await appel({ methode: "GET", url: `https://api.stripe.com/v1/balance_transactions?${params}`, entetes: [["Authorization", `Bearer ${secret.cle}`]] }),
      "Stripe",
    );
    for (const t of json.data ?? []) {
      const date = dateDepuisUnix(t.created);
      const devise = String(t.currency ?? "eur").toUpperCase();
      if (TYPES_PAIEMENT.has(t.type) || TYPES_REMBOURSEMENT.has(t.type)) {
        lignes.push({
          sens: "revenu",
          ref: `stripe-${t.id}`,
          date,
          montantCents: t.amount,
          devise,
          libelle: TYPES_REMBOURSEMENT.has(t.type) ? `Remboursement Stripe${t.description ? ` · ${t.description}` : ""}` : t.description || "Paiement Stripe",
        });
      }
      if (t.fee > 0 && devise === "EUR") frais.push({ jour: date, cents: t.fee });
    }
    if (!json.has_more || !json.data?.length) break;
    apres = json.data.at(-1).id;
  }
  return [
    ...lignes,
    ...cumulParMois(frais, { prefixe: "stripe-frais", libelle: "Frais Stripe", devise: "EUR", aujourdhui, fournisseur: "Stripe", categorie: "saas" }),
  ];
}

/* --------------------------------------------------------------- Anthropic */

async function synchroniserAnthropic({ secret, depuis, appel, aujourdhui }) {
  const jours = [];
  let suivante = null;
  for (let page = 0; page < 40; page += 1) {
    const params = new URLSearchParams({ starting_at: `${depuis}T00:00:00Z`, bucket_width: "1d", limit: "31" });
    if (suivante) params.set("page", suivante);
    const json = verifier(
      await appel({
        methode: "GET",
        url: `https://api.anthropic.com/v1/organizations/cost_report?${params}`,
        entetes: [
          ["x-api-key", secret.cle],
          ["anthropic-version", "2023-06-01"],
        ],
      }),
      "Anthropic",
    );
    for (const tranche of json.data ?? []) {
      // Montants en CENTIMES de dollar, sous forme de chaine decimale
      const cents = (tranche.results ?? []).reduce((t, r) => t + (Number.parseFloat(r.amount) || 0), 0);
      jours.push({ jour: String(tranche.starting_at).slice(0, 10), cents });
    }
    if (!json.has_more || !json.next_page) break;
    suivante = json.next_page;
  }
  return cumulParMois(jours, { prefixe: "anthropic", libelle: "API Anthropic", devise: "USD", aujourdhui, fournisseur: "Anthropic", categorie: "api" });
}

/* ------------------------------------------------------------------ OpenAI */

async function synchroniserOpenAI({ secret, depuis, appel, aujourdhui }) {
  const jours = [];
  let suivante = null;
  for (let page = 0; page < 40; page += 1) {
    const params = new URLSearchParams({
      start_time: String(Math.floor(new Date(`${depuis}T00:00:00Z`).getTime() / 1000)),
      bucket_width: "1d",
      limit: "180",
    });
    if (suivante) params.set("page", suivante);
    const json = verifier(
      await appel({ methode: "GET", url: `https://api.openai.com/v1/organization/costs?${params}`, entetes: [["Authorization", `Bearer ${secret.cle}`]] }),
      "OpenAI",
    );
    for (const tranche of json.data ?? []) {
      // Montants en dollars
      const dollars = (tranche.results ?? []).reduce((t, r) => t + (Number(r.amount?.value) || 0), 0);
      jours.push({ jour: dateDepuisUnix(tranche.start_time), cents: dollars * 100 });
    }
    if (!json.has_more || !json.next_page) break;
    suivante = json.next_page;
  }
  return cumulParMois(jours, { prefixe: "openai", libelle: "API OpenAI", devise: "USD", aujourdhui, fournisseur: "OpenAI", categorie: "api" });
}

/* --------------------------------------------------------------------- OVH */

const OVH = "https://eu.api.ovh.com/1.0";

async function sha1Hex(texte) {
  const octets = await globalThis.crypto.subtle.digest("SHA-1", new TextEncoder().encode(texte));
  return [...new Uint8Array(octets)].map((o) => o.toString(16).padStart(2, "0")).join("");
}

/** En-tetes signes de l'API OVH : $1$ + SHA1(AS+CK+METHODE+URL+CORPS+HORODATAGE). */
export async function signatureOvh({ cleApplication, secretApplication, cleConsommateur }, methode, url, horodatage, corps = "") {
  const signature = `$1$${await sha1Hex([secretApplication, cleConsommateur, methode, url, corps, horodatage].join("+"))}`;
  return [
    ["X-Ovh-Application", cleApplication],
    ["X-Ovh-Consumer", cleConsommateur],
    ["X-Ovh-Timestamp", String(horodatage)],
    ["X-Ovh-Signature", signature],
  ];
}

async function synchroniserOvh({ secret, depuis, appel }) {
  // L'horloge d'OVH fait foi : un ecart avec la machine invaliderait la signature
  const temps = verifier(await appel({ methode: "GET", url: `${OVH}/auth/time`, entetes: [] }), "OVH");
  const decalage = Number(temps) - Math.floor(Date.now() / 1000);
  const signe = async (url) =>
    verifier(
      await appel({ methode: "GET", url, entetes: await signatureOvh(secret, "GET", url, Math.floor(Date.now() / 1000) + decalage) }),
      "OVH",
    );

  const ids = await signe(`${OVH}/me/bill?date.from=${depuis}`);
  const lignes = [];
  for (const id of ids ?? []) {
    const facture = await signe(`${OVH}/me/bill/${encodeURIComponent(id)}`);
    const prix = facture.priceWithTax ?? facture.priceWithoutTax;
    if (!prix?.value) continue;
    lignes.push({
      sens: "depense",
      ref: `ovh-${facture.billId ?? id}`,
      date: String(facture.date).slice(0, 10),
      montantCents: Math.round(prix.value * 100),
      devise: prix.currencyCode ?? "EUR",
      libelle: `Facture OVH ${facture.billId ?? id}`,
      fournisseur: "OVH",
      categorie: "hebergement",
    });
  }
  return lignes;
}

/* ------------------------------------------------------------- catalogue */

export const CONNECTEURS = [
  {
    type: "stripe",
    nom: "Stripe",
    description: "Paiements et remboursements en revenus, frais Stripe en dépense mensuelle.",
    couleur: "#635bff",
    champs: [{ cle: "cle", libelle: "Clé restreinte (rk_live_…)", aide: "Dashboard Stripe › Développeurs › Clés API › Créer une clé restreinte, droit « Lecture » sur « Balance »." }],
    synchroniser: synchroniserStripe,
  },
  {
    type: "anthropic",
    nom: "Anthropic (API Claude)",
    description: "Coût de l'API, une dépense par mois mise à jour chaque jour. L'abonnement Claude Max n'y figure pas.",
    couleur: "#d97757",
    champs: [{ cle: "cle", libelle: "Clé Admin (sk-ant-admin…)", aide: "Console Anthropic › Settings › Admin keys. Réservé aux administrateurs de l'organisation." }],
    synchroniser: synchroniserAnthropic,
  },
  {
    type: "openai",
    nom: "OpenAI (API)",
    description: "Coût de l'API, une dépense par mois mise à jour chaque jour. ChatGPT Plus n'y figure pas.",
    couleur: "#10a37f",
    champs: [{ cle: "cle", libelle: "Clé Admin (sk-admin-…)", aide: "platform.openai.com › Settings › Organization › Admin keys." }],
    synchroniser: synchroniserOpenAI,
  },
  {
    type: "ovh",
    nom: "OVHcloud",
    description: "Factures OVH (hébergement, domaines) en dépenses, une par facture.",
    couleur: "#123f6d",
    champs: [
      { cle: "cleApplication", libelle: "Application key" },
      { cle: "secretApplication", libelle: "Application secret" },
      { cle: "cleConsommateur", libelle: "Consumer key", aide: "Créées sur https://eu.api.ovh.com/createToken/ avec le droit GET sur /me/bill et /me/bill/*." },
    ],
    synchroniser: synchroniserOvh,
  },
];

export function definition(type) {
  return CONNECTEURS.find((c) => c.type === type) ?? null;
}
