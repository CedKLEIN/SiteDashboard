import { describe, expect, it } from "vitest";
import { dernierResultat, heure, resumeAssertions, texteCheck } from "./affichageChecks";

describe("affichage d'un check", () => {
  const sitemap = {
    libelle: "Sitemap (index)",
    url: "https://denivio.fr/sitemap.xml",
    type: "http",
    doit_contenir: "<sitemap>",
    occurrences_min: 3,
    dernier_ok: 1,
    dernier_statut: 200,
    derniere_verif: "2026-10-25 10:02:43",
    derniere_latence: 106,
  };

  it("resume ce que le check verifie", () => {
    expect(resumeAssertions(sitemap)).toBe('3x "<sitemap>"');
    expect(resumeAssertions({ doit_contenir: "window.", taille_min_octets: 64 })).toBe(
      'contient "window." · ≥ 64 o',
    );
  });

  it("dit le dernier resultat selon le type", () => {
    expect(dernierResultat(sitemap)).toBe("HTTP 200");
    expect(dernierResultat({ type: "tls", dernier_ok: 1, derniers_jours: 32 })).toBe(
      "valide encore 32 jour(s)",
    );
    expect(dernierResultat({ type: "http", dernier_ok: 0, derniere_erreur: "statut HTTP 502" })).toBe(
      "statut HTTP 502",
    );
  });

  it("met le check en une ligne a coller", () => {
    expect(heure("2026-10-25 10:02:43")).toBe("10:02");
    expect(texteCheck(sitemap)).toBe(
      'Sitemap (index) — https://denivio.fr/sitemap.xml — 3x "<sitemap>" — OK : HTTP 200 a 10:02 — 106 ms',
    );
    expect(texteCheck({ libelle: "Neuf", url: "https://x.fr" })).toBe("Neuf — https://x.fr — jamais verifie");
  });
});
