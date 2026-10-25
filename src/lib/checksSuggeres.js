/**
 * Catalogue de checks courants, propose en un clic sur l'ecran de detail.
 *
 * Chaque entree vient d'un besoin constate sur les sites reellement deployes
 * (Denivio, HistorySite): ce ne sont pas des suggestions generiques.
 * `doitContenir` est aussi important que le statut: la plupart de ces
 * ressources peuvent repondre 200 tout en etant inexploitables. Et les cinq
 * dernieres entrees existent parce qu'un statut 200 avec le bon contenu ne dit
 * toujours rien des en-tetes, des redirections ni de la version deployee.
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
    // Meme piege en version degradee: un 200 sur un fichier retreci.
    tailleMinOctets: 64,
    description: "Fichier reecrit au demarrage du conteneur : un 200 ne suffit pas",
  },
  {
    cle: "sante",
    libelle: "Santé de l'API",
    chemin: "/healthz",
    doitContenir: null,
    description: "Endpoint de santé applicatif (souvent /healthz ou /health)",
  },
  {
    cle: "sitemap",
    libelle: "Sitemap",
    chemin: "/sitemap.xml",
    // Un sitemap servi par l'API peut repondre 200 avec une page d'erreur HTML:
    // on verifie donc que c'est bien du XML de sitemap. Pas `<urlset`: passe
    // 50 000 URL, sitemap.xml devient un <sitemapindex> (Denivio, octobre 2026)
    // et le check echouait sur un site sain. L'espace de noms est dans les deux.
    doitContenir: "sitemaps.org/schemas/sitemap",
    // Un sitemap genere depuis la base contient des milliers d'URL. S'il se
    // vidait, il repondrait 200 et garderait son espace de noms: seule la
    // taille trahit un catalogue tombe a quelques lignes. Le plancher reste
    // sous un index de 2 entrees (~300 octets) et au-dessus d'un sitemap vide.
    tailleMinOctets: 256,
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
    description: "Alerte avant l'expiration du certificat, pas après la panne",
  },
  {
    cle: "manifest",
    libelle: "Manifest PWA",
    chemin: "/manifest.webmanifest",
    doitContenir: null,
    description: "Manifeste d'installation de l'application web",
  },
  {
    cle: "entetes",
    libelle: "En-têtes de sécurité",
    chemin: "/",
    doitContenir: null,
    // Le cas qui a motive ces regles: un durcissement nginx commite mais jamais
    // monte sur le VPS. Le site repondait 200 et servait ses pages; seul
    // "Server: nginx/1.18.0 (Ubuntu)" au lieu de "nginx" trahissait la
    // regression. Une protection qui disparait ne change ni statut ni corps.
    entetes: [
      { nom: "strict-transport-security", operateur: "present", valeur: null },
      { nom: "content-security-policy", operateur: "present", valeur: null },
      { nom: "server", operateur: "ne_contient_pas", valeur: "/" },
    ],
    description: "HSTS, CSP, et un en-tête Server qui n'annonce pas sa version",
  },
  {
    cle: "www",
    libelle: "Redirection www",
    type: "redirection",
    description: "L'autre forme du domaine redirige, au lieu de servir le site en double",
    // www.denivio.fr servait le site en 200 au lieu de rediriger: 4417 URL
    // publiees a deux adresses. Un check HTTP serait passe au vert.
    construire(base) {
      const hote = base.hostname.startsWith("www.")
        ? base.hostname.slice(4)
        : `www.${base.hostname}`;
      return {
        url: `${base.protocol}//${hote}/`,
        cibleAttendue: `${base.protocol}//${base.hostname}/`,
      };
    },
  },
  {
    cle: "https",
    libelle: "Bascule en https",
    type: "redirection",
    description: "Le http ne cesse pas silencieusement de basculer en https",
    construire(base) {
      if (base.protocol !== "https:") return null;
      return {
        url: `http://${base.host}/`,
        cibleAttendue: `https://${base.host}/`,
      };
    },
  },
  {
    cle: "domaine",
    libelle: "Nom de domaine",
    type: "domaine",
    description: "Expiration du domaine (RDAP) et adresses vers lesquelles il resout",
    construire(base) {
      return {
        url: base.origin,
        domaine: base.hostname.replace(/^www\./, ""),
      };
    },
  },
  {
    cle: "version",
    libelle: "Version déployée",
    chemin: "/version.json",
    type: "valeur",
    extracteur: "json:buildId",
    description: "Affiche le build en production et depuis quand - sans verdict",
  },
];

/**
 * Construit une URL absolue a partir de l'URL de base du site et d'un chemin.
 *
 * Un chemin deja absolu (http://, https://) est respecte tel quel: un check
 * peut viser une API sur un autre domaine, il ne faut pas le prefixer de force.
 */
export function urlDepuisChemin(urlSite, chemin) {
  const saisi = String(chemin ?? "").trim();
  if (/^https?:\/\//i.test(saisi)) return saisi;
  return urlSuggestion(urlSite, saisi || "/");
}

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

/**
 * Developpe une suggestion pour un site: son URL et ses champs propres.
 *
 * Les suggestions qui ne visent pas une ressource SOUS le site - l'autre forme
 * du domaine, la bascule http, le nom de domaine lui-meme - portent un
 * `construire` qui recoit l'URL analysee. Il peut renvoyer null: proposer une
 * bascule https a un site deja en http n'aurait aucun sens.
 */
function developper(suggestion, urlSite) {
  const base = { ...suggestion, type: suggestion.type ?? "http" };
  delete base.construire;

  if (!suggestion.construire) {
    return { ...base, url: urlSuggestion(urlSite, suggestion.chemin) };
  }
  if (!urlSite) return { ...base, url: null };

  try {
    const extras = suggestion.construire(new URL(urlSite));
    return extras ? { ...base, ...extras } : { ...base, url: null };
  } catch {
    return { ...base, url: null };
  }
}

/** Suggestions restantes: on masque celles dont l'URL est deja surveillee. */
export function suggestionsRestantes(urlSite, checksExistants = []) {
  // Un check TLS et un check HTTP peuvent viser la meme URL sans faire doublon:
  // ils ne verifient pas la meme chose. La cle de deduplication est (type, url).
  const dejaTypes = new Set(checksExistants.map((c) => `${c.type ?? "http"}|${c.url}`));
  return CHECKS_SUGGERES.map((s) => developper(s, urlSite)).filter(
    (s) => s.url !== null && !dejaTypes.has(`${s.type}|${s.url}`),
  );
}
