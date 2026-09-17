import { describe, expect, it } from "vitest";
import {
  CHECKS_SUGGERES,
  suggestionsRestantes,
  urlDepuisChemin,
  urlSuggestion,
} from "./checksSuggeres";

describe("urlSuggestion", () => {
  it("construit une URL absolue", () => {
    expect(urlSuggestion("https://denivio.fr", "/config.js")).toBe("https://denivio.fr/config.js");
  });

  it("ne double pas le slash quand le site finit par /", () => {
    expect(urlSuggestion("https://denivio.fr/", "/robots.txt")).toBe(
      "https://denivio.fr/robots.txt",
    );
  });

  it("respecte un site heberge sous un sous-chemin", () => {
    expect(urlSuggestion("https://exemple.fr/histoire", "/sitemap.xml")).toBe(
      "https://exemple.fr/histoire/sitemap.xml",
    );
  });

  it("renvoie null sans URL de site, plutot qu'une URL cassee", () => {
    expect(urlSuggestion(null, "/")).toBeNull();
    expect(urlSuggestion("", "/")).toBeNull();
    expect(urlSuggestion("pas une url", "/")).toBeNull();
  });
});

describe("suggestionsRestantes", () => {
  it("propose tout le catalogue sur un site sans check", () => {
    expect(suggestionsRestantes("https://denivio.fr", [])).toHaveLength(CHECKS_SUGGERES.length);
  });

  it("masque une suggestion deja surveillee", () => {
    const restantes = suggestionsRestantes("https://denivio.fr", [
      { url: "https://denivio.fr/config.js" },
    ]);
    expect(restantes.map((s) => s.cle)).not.toContain("config");
    expect(restantes).toHaveLength(CHECKS_SUGGERES.length - 1);
  });

  it("ne propose rien pour un site sans URL", () => {
    expect(suggestionsRestantes(null, [])).toEqual([]);
  });

  it("verifie le contenu la ou un 200 ne prouve rien", () => {
    const parCle = Object.fromEntries(CHECKS_SUGGERES.map((s) => [s.cle, s]));
    expect(parCle.config.doitContenir).toBe("window.");
    expect(parCle.sitemap.doitContenir).toBe("<urlset");
    expect(parCle.robots.doitContenir).toBe("User-agent");
  });

  it("garde une taille plancher la ou un 200 peut etre retreci", () => {
    const parCle = Object.fromEntries(CHECKS_SUGGERES.map((s) => [s.cle, s]));
    // Un config.js vide et un sitemap vide repondent 200 comme les autres.
    expect(parCle.config.tailleMinOctets).toBeGreaterThan(0);
    expect(parCle.sitemap.tailleMinOctets).toBeGreaterThan(0);
  });

  it("propose les en-tetes de securite qui ne laissent aucune autre trace", () => {
    const [entetes] = suggestionsRestantes("https://denivio.fr", []).filter(
      (s) => s.cle === "entetes",
    );
    const parNom = Object.fromEntries(entetes.entetes.map((r) => [r.nom, r]));
    expect(parNom["strict-transport-security"].operateur).toBe("present");
    expect(parNom["content-security-policy"].operateur).toBe("present");
    // "Server: nginx/1.18.0 (Ubuntu)" etait le seul temoin de la regression.
    expect(parNom.server).toMatchObject({ operateur: "ne_contient_pas", valeur: "/" });
  });

  it("vise l'autre forme du domaine pour la redirection www", () => {
    const parCle = (url) =>
      Object.fromEntries(suggestionsRestantes(url, []).map((s) => [s.cle, s]));

    expect(parCle("https://denivio.fr")).toMatchObject({
      www: { url: "https://www.denivio.fr/", cibleAttendue: "https://denivio.fr/" },
    });
    // Symetrique: un site canonique en www fait verifier la forme sans www.
    expect(parCle("https://www.exemple.fr")).toMatchObject({
      www: { url: "https://exemple.fr/", cibleAttendue: "https://www.exemple.fr/" },
    });
  });

  it("ne propose la bascule https qu'a un site deja en https", () => {
    const cles = (url) => suggestionsRestantes(url, []).map((s) => s.cle);
    expect(cles("https://denivio.fr")).toContain("https");
    expect(cles("http://vieux-site.fr")).not.toContain("https");
  });

  it("interroge le domaine nu, pas la forme www", () => {
    const [domaine] = suggestionsRestantes("https://www.denivio.fr", []).filter(
      (s) => s.cle === "domaine",
    );
    expect(domaine.domaine).toBe("denivio.fr");
  });

  it("masque une redirection deja surveillee malgre son type", () => {
    const restantes = suggestionsRestantes("https://denivio.fr", [
      { type: "redirection", url: "https://www.denivio.fr/" },
    ]);
    expect(restantes.map((s) => s.cle)).not.toContain("www");
    // Un check HTTP sur la meme URL ne verifierait pas la meme chose
    const avecHttp = suggestionsRestantes("https://denivio.fr", [
      { type: "http", url: "https://www.denivio.fr/" },
    ]);
    expect(avecHttp.map((s) => s.cle)).toContain("www");
  });
});

describe("urlDepuisChemin", () => {
  it("prefixe un chemin par l'URL du site", () => {
    expect(urlDepuisChemin("https://denivio.fr", "/api/health")).toBe(
      "https://denivio.fr/api/health",
    );
  });

  it("accepte un chemin sans slash initial", () => {
    expect(urlDepuisChemin("https://denivio.fr", "config.js")).toBe(
      "https://denivio.fr/config.js",
    );
  });

  it("respecte une URL absolue: un check peut viser un autre domaine", () => {
    expect(urlDepuisChemin("https://denivio.fr", "https://api.autre.fr/sante")).toBe(
      "https://api.autre.fr/sante",
    );
  });

  it("retombe sur la racine quand le chemin est vide", () => {
    expect(urlDepuisChemin("https://denivio.fr", "  ")).toBe("https://denivio.fr/");
  });
});
