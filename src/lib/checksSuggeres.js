/**
 * Catalogue de checks courants, propose en un clic sur l'ecran de detail.
 *
 * Chaque entree vient d'un besoin constate sur les sites reellement deployes
 * (Denivio, HistorySite): ce ne sont pas des suggestions generiques.
 * `doitContenir` est aussi important que le statut: la plupart de ces
 * ressources peuvent repondre 200 tout en etant inexploitables.
 */
export const CHECKS_SUGGERES = [
  {
    cle: "accueil",
    libelle: "Page d'accueil",
    chemin: "/",
    doitContenir: null,
    description: "Le site repond et sert sa page",
  },
  {
    cle: "config",
    libelle: "Configuration runtime",
    chemin: "/config.js",
    // Le conteneur reecrit ce fichier a chaque demarrage a partir de son .env.
    // Si l'entrypoint echoue, nginx sert quand meme un 200 - sur un fichier vide
    // ou tronque. Le symptome est une carte muette, pas une erreur.
    doitContenir: "window.",
    description: "Fichier reecrit au demarrage du conteneur : un 200 ne suffit pas",
  },
  {
    cle: "sante",
    libelle: "Sante de l'API",
    chemin: "/healthz",
    doitContenir: null,
    description: "Endpoint de sante applicatif (souvent /healthz ou /health)",
  },
  {
    cle: "sitemap",
    libelle: "Sitemap",
    chemin: "/sitemap.xml",
    // Un sitemap servi par l'API peut repondre 200 avec une page d'erreur HTML:
    // on verifie donc que c'est bien du XML de sitemap.
    doitContenir: "<urlset",
    description: "Presence et validite minimale du sitemap (SEO)",
  },
  {
    cle: "robots",
    libelle: "robots.txt",
    chemin: "/robots.txt",
    doitContenir: "User-agent",
    description: "Le fichier robots est servi et non vide",
  },
  {
    cle: "certificat",
    libelle: "Certificat TLS",
    chemin: "/",
    type: "tls",
    doitContenir: null,
    description: "Alerte avant l'expiration du certificat, pas apres la panne",
  },
  {
    cle: "manifest",
    libelle: "Manifest PWA",
    chemin: "/manifest.webmanifest",
    doitContenir: null,
    description: "Manifeste d'installation de l'application web",
  },
];

/**
 * Construit l'URL absolue d'une suggestion pour un site donne.
 * Renvoie null si le site n'a pas d'URL exploitable.
 */
export function urlSuggestion(urlSite, chemin) {
  if (!urlSite) return null;
  try {
    // `new URL` avec une base gere les sites heberges sous un sous-chemin
    // et normalise les doubles slash.
    return new URL(chemin.replace(/^\//, ""), urlSite.endsWith("/") ? urlSite : `${urlSite}/`).href;
  } catch {
    return null;
  }
}

/** Suggestions restantes: on masque celles dont l'URL est deja surveillee. */
export function suggestionsRestantes(urlSite, checksExistants = []) {
  // Un check TLS et un check HTTP peuvent viser la meme URL sans faire doublon:
  // ils ne verifient pas la meme chose. La cle de deduplication est (type, url).
  const dejaTypes = new Set(checksExistants.map((c) => `${c.type ?? "http"}|${c.url}`));
  return CHECKS_SUGGERES.map((s) => ({
    ...s,
    type: s.type ?? "http",
    url: urlSuggestion(urlSite, s.chemin),
  })).filter((s) => s.url !== null && !dejaTypes.has(`${s.type}|${s.url}`));
}
