import { describe, expect, it } from "vitest";
import { CHECKS_SUGGERES, suggestionsRestantes, urlSuggestion } from "./checksSuggeres";

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
});
