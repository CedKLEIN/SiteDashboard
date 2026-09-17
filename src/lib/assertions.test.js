import { describe, expect, it } from "vitest";
import {
  evaluerDomaine,
  evaluerRedirection,
  evaluerReponse,
  formaterRegles,
  intervalleParDefaut,
  memeUrl,
  parserRegles,
  verdictEntetes,
} from "./assertions";

/** Une reponse qui passe, qu'on degrade au cas par cas. */
function reponseOk(extras = {}) {
  return { statut: 200, entetes: [], taille: 1000, ...extras };
}

describe("priorite des messages d'echec", () => {
  it("signale le statut avant le fragment", () => {
    // Cas reel rencontre: un /config.js inexistant renvoyait 404, et le check
    // annoncait "fragment absent" - ce qui envoyait chercher un probleme de
    // contenu alors que le fichier n'existe simplement pas.
    const verdict = evaluerReponse(
      { doit_contenir: "window." },
      reponseOk({ statut: 404, occurrences: 0 }),
    );
    expect(verdict).toEqual({ ok: false, message: "statut HTTP 404" });
  });

  it("signale le fragment quand le statut est bon", () => {
    const verdict = evaluerReponse({ doit_contenir: "window." }, reponseOk({ occurrences: 0 }));
    expect(verdict).toEqual({ ok: false, message: "fragment absent: window." });
  });

  it("signale le contenu avant les en-tetes", () => {
    // Une mauvaise page explique des en-tetes manquants; l'inverse n'est pas vrai.
    const check = {
      doit_contenir: "window.",
      entetes: [{ nom: "content-security-policy", operateur: "present" }],
    };
    const verdict = evaluerReponse(check, reponseOk({ occurrences: 0 }));
    expect(verdict.message).toBe("fragment absent: window.");
  });

  it("ne signale rien quand tout va bien", () => {
    expect(evaluerReponse({}, reponseOk())).toEqual({ ok: true, message: null });
  });

  it("remonte une erreur reseau telle quelle", () => {
    const verdict = evaluerReponse({}, { erreur: "delai depasse" });
    expect(verdict).toEqual({ ok: false, message: "delai depasse" });
  });

  it("accepte tout 2xx sans statut attendu, et refuse un 3xx avale", () => {
    expect(evaluerReponse({}, reponseOk({ statut: 204 })).ok).toBe(true);
    expect(evaluerReponse({}, reponseOk({ statut: 301 })).ok).toBe(false);
  });

  it("exige le statut exact quand il est precise", () => {
    expect(evaluerReponse({ statut_attendu: 204 }, reponseOk({ statut: 200 })).ok).toBe(false);
  });
});

describe("taille et occurrences", () => {
  it("refuse un corps retreci meme avec le bon fragment", () => {
    // Le sitemap de Denivio porte 4417 URL. Vide, il repondrait 200 et
    // contiendrait toujours <urlset.
    const check = { doit_contenir: "<urlset", taille_min_octets: 1024 };
    const verdict = evaluerReponse(check, reponseOk({ occurrences: 1, taille: 120 }));
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toBe("corps de 120 octet(s), minimum 1024");
  });

  it("compte les occurrences quand un minimum est exige", () => {
    const check = { doit_contenir: "<url>", occurrences_min: 10 };
    const verdict = evaluerReponse(check, reponseOk({ occurrences: 3 }));
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toBe('3 occurrence(s) de "<url>", 10 attendue(s)');
  });

  it("passe des que le compte y est", () => {
    const check = { doit_contenir: "<url>", occurrences_min: 10 };
    expect(evaluerReponse(check, reponseOk({ occurrences: 10 })).ok).toBe(true);
  });

  it("garde le message historique a une seule occurrence attendue", () => {
    const check = { doit_contenir: "window.", occurrences_min: 1 };
    expect(evaluerReponse(check, reponseOk({ occurrences: 0 })).message).toBe(
      "fragment absent: window.",
    );
  });

  it("ignore la taille quand aucun minimum n'est demande", () => {
    expect(evaluerReponse({}, reponseOk({ taille: 0 })).ok).toBe(true);
  });
});

describe("assertions sur les en-tetes", () => {
  const recus = [
    ["content-type", "text/html; charset=utf-8"],
    ["server", "nginx/1.18.0 (Ubuntu)"],
  ];

  it("detecte un en-tete de securite disparu", () => {
    const regles = [{ nom: "strict-transport-security", operateur: "present" }];
    expect(verdictEntetes(regles, recus)).toBe("en-tete absent: strict-transport-security");
  });

  it("detecte une version de serveur exposee", () => {
    // Le cas reel: le durcissement nginx n'etait pas monte sur le VPS, et
    // "Server: nginx/1.18.0 (Ubuntu)" etait le seul temoin visible.
    const regles = [{ nom: "server", operateur: "ne_contient_pas", valeur: "/" }];
    expect(verdictEntetes(regles, recus)).toBe(
      'server contient "/" (nginx/1.18.0 (Ubuntu))',
    );
  });

  it("passe quand la version n'est plus annoncee", () => {
    const regles = [{ nom: "server", operateur: "ne_contient_pas", valeur: "/" }];
    expect(verdictEntetes(regles, [["server", "nginx"]])).toBeNull();
  });

  it("ignore la casse du nom comme de la valeur", () => {
    const regles = [{ nom: "Content-Type", operateur: "contient", valeur: "TEXT/HTML" }];
    expect(verdictEntetes(regles, recus)).toBeNull();
  });

  it("traite un en-tete absent comme un 'contient' en defaut", () => {
    const regles = [{ nom: "x-robots-tag", operateur: "contient", valeur: "noindex" }];
    expect(verdictEntetes(regles, recus)).toBe("en-tete absent: x-robots-tag");
  });

  it("considere une regle 'ne contient pas' satisfaite si l'en-tete manque", () => {
    const regles = [{ nom: "x-powered-by", operateur: "ne_contient_pas", valeur: "PHP" }];
    expect(verdictEntetes(regles, recus)).toBeNull();
  });

  it("n'annonce qu'une regle et compte les autres", () => {
    // Lister trois en-tetes dans une carte de site la rendrait illisible.
    const regles = [
      { nom: "strict-transport-security", operateur: "present" },
      { nom: "content-security-policy", operateur: "present" },
      { nom: "server", operateur: "ne_contient_pas", valeur: "/" },
    ];
    expect(verdictEntetes(regles, recus)).toBe(
      "en-tete absent: strict-transport-security (+2 autre(s))",
    );
  });

  it("ne dit rien quand aucune regle n'est posee", () => {
    expect(verdictEntetes([], recus)).toBeNull();
  });
});

describe("mini-syntaxe des regles d'en-tetes", () => {
  it("lit les quatre formes", () => {
    const regles = parserRegles(
      ["strict-transport-security", "!x-powered-by", "content-type: json", "!server: /"].join("\n"),
    );
    expect(regles).toEqual([
      { nom: "strict-transport-security", operateur: "present", valeur: null },
      { nom: "x-powered-by", operateur: "absent", valeur: null },
      { nom: "content-type", operateur: "contient", valeur: "json" },
      { nom: "server", operateur: "ne_contient_pas", valeur: "/" },
    ]);
  });

  it("normalise la casse et ignore les lignes vides", () => {
    expect(parserRegles("  Server \n\n  ")).toEqual([
      { nom: "server", operateur: "present", valeur: null },
    ]);
  });

  it("ramene 'nom:' sans valeur a une presence", () => {
    // Un 'contient ""' serait une regle toujours vraie: un piege silencieux.
    expect(parserRegles("server:")).toEqual([
      { nom: "server", operateur: "present", valeur: null },
    ]);
  });

  it("conserve une valeur qui contient des deux-points", () => {
    const [regle] = parserRegles("content-security-policy: default-src 'self'; img-src data:");
    expect(regle.valeur).toBe("default-src 'self'; img-src data:");
  });

  it("fait l'aller-retour avec l'affichage", () => {
    const texte = "strict-transport-security\n!x-powered-by\ncontent-type: json\n!server: /";
    expect(formaterRegles(parserRegles(texte))).toBe(texte);
  });
});

describe("checks de redirection", () => {
  const check = { url: "https://www.denivio.fr/", cible_attendue: "https://denivio.fr/" };

  it("echoue sur un 200, qui est precisement le bug", () => {
    // www.denivio.fr servait le site au lieu de rediriger: un check HTTP
    // classique serait passe au vert.
    const verdict = evaluerRedirection(check, { statut: 200 });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toBe("statut HTTP 200 au lieu d'une redirection");
  });

  it("accepte la bonne cible", () => {
    const verdict = evaluerRedirection(check, { statut: 301, cible: "https://denivio.fr/" });
    expect(verdict).toEqual({ ok: true, message: "301 vers https://denivio.fr/" });
  });

  it("refuse une cible inattendue", () => {
    const verdict = evaluerRedirection(check, { statut: 302, cible: "https://ailleurs.fr/" });
    expect(verdict.message).toBe(
      "redirige vers https://ailleurs.fr/ au lieu de https://denivio.fr/",
    );
  });

  it("detecte une boucle de redirection", () => {
    const verdict = evaluerRedirection(check, { statut: 301, cible: "https://www.denivio.fr/" });
    expect(verdict.message).toBe("boucle de redirection vers https://www.denivio.fr/");
  });

  it("signale une redirection sans Location", () => {
    expect(evaluerRedirection(check, { statut: 301 }).message).toBe(
      "redirection 301 sans en-tete Location",
    );
  });

  it("verifie le code exact APRES la cible", () => {
    // Rediriger au mauvais endroit est plus grave que rediriger en 302 plutot
    // qu'en 301: annoncer le code masquerait le vrai probleme.
    const strict = { ...check, statut_attendu: 301 };
    expect(evaluerRedirection(strict, { statut: 302, cible: "https://ailleurs.fr/" }).message).toBe(
      "redirige vers https://ailleurs.fr/ au lieu de https://denivio.fr/",
    );
    expect(evaluerRedirection(strict, { statut: 302, cible: "https://denivio.fr/" }).message).toBe(
      "redirection 302 au lieu de 301",
    );
  });

  it("surveille aussi la bascule http vers https", () => {
    const bascule = { url: "http://denivio.fr/", cible_attendue: "https://denivio.fr/" };
    expect(evaluerRedirection(bascule, { statut: 200 }).ok).toBe(false);
    expect(evaluerRedirection(bascule, { statut: 301, cible: "https://denivio.fr/" }).ok).toBe(true);
  });
});

describe("comparaison d'URL", () => {
  it("ignore le slash final sur une racine", () => {
    expect(memeUrl("https://denivio.fr", "https://denivio.fr/")).toBe(true);
  });

  it("ne confond pas /a et /a/", () => {
    // Ce ne sont pas la meme ressource: faire semblant laisserait passer une
    // vraie regression.
    expect(memeUrl("https://denivio.fr/a", "https://denivio.fr/a/")).toBe(false);
  });

  it("ignore la casse de l'hote, pas celle du chemin", () => {
    expect(memeUrl("https://Denivio.FR/a", "https://denivio.fr/a")).toBe(true);
    expect(memeUrl("https://denivio.fr/A", "https://denivio.fr/a")).toBe(false);
  });

  it("distingue http et https", () => {
    expect(memeUrl("http://denivio.fr/", "https://denivio.fr/")).toBe(false);
  });
});

describe("checks de domaine", () => {
  const check = { domaine: "denivio.fr", cible_attendue: "51.83.12.4", seuil_jours: 30 };

  it("alerte quand le domaine ne pointe plus au bon endroit", () => {
    const verdict = evaluerDomaine(check, { adresses: ["1.2.3.4"], jours_restants: 200 });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toBe("resout vers 1.2.3.4 au lieu de 51.83.12.4");
  });

  it("echoue AVANT l'expiration, comme pour un certificat", () => {
    const verdict = evaluerDomaine(check, { adresses: ["51.83.12.4"], jours_restants: 12 });
    expect(verdict).toEqual({ ok: false, message: "domaine expire dans 12 jour(s)" });
  });

  it("annonce un domaine deja expire", () => {
    const verdict = evaluerDomaine(check, { adresses: ["51.83.12.4"], jours_restants: -3 });
    expect(verdict.message).toBe("domaine expire depuis 3 jour(s)");
  });

  it("passe au vert loin de l'echeance", () => {
    const verdict = evaluerDomaine(check, { adresses: ["51.83.12.4"], jours_restants: 200 });
    expect(verdict).toEqual({ ok: true, message: "51.83.12.4 · expire dans 200 jour(s)" });
  });

  it("n'echoue pas sur une expiration illisible", () => {
    // Un TLD sans serveur RDAP n'est pas un probleme du domaine: crier sur une
    // absence de donnee userait l'alerte pour rien.
    const verdict = evaluerDomaine(check, {
      adresses: ["51.83.12.4"],
      erreur_expiration: "aucun serveur RDAP pour ce domaine",
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.message).toContain("aucun serveur RDAP");
  });

  it("remonte un echec de resolution DNS", () => {
    const verdict = evaluerDomaine(check, { erreur: "resolution impossible" });
    expect(verdict).toEqual({ ok: false, message: "resolution impossible" });
  });

  it("ne juge que l'expiration sans cible attendue", () => {
    const libre = { domaine: "denivio.fr" };
    expect(evaluerDomaine(libre, { adresses: ["1.2.3.4"], jours_restants: 200 }).ok).toBe(true);
  });
});

describe("cadence par type", () => {
  it("laisse les checks HTTP a chaque cycle", () => {
    expect(intervalleParDefaut("http")).toBeNull();
    expect(intervalleParDefaut("redirection")).toBeNull();
  });

  it("espace les checks couteux ou inutilement frequents", () => {
    // RDAP interroge 1440 fois par jour pour une date annuelle se fait
    // rate-limiter; une poignee de main TLS chaque minute n'est pas mieux.
    expect(intervalleParDefaut("domaine")).toBe(43200);
    expect(intervalleParDefaut("tls")).toBe(21600);
    expect(intervalleParDefaut("valeur")).toBe(900);
  });

  it("retombe sur chaque cycle pour un type inconnu", () => {
    expect(intervalleParDefaut("inedit")).toBeNull();
  });
});
