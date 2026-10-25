import { describe, expect, it } from "vitest";
import {
  dernierResultat,
  heure,
  regrouperIncidents,
  resumeAssertions,
  texteCheck,
  tonDisponibilite,
} from "./affichageChecks";

describe("regrouperIncidents", () => {
  const incident = (minute, check_libelle = "Sitemap (index)", erreur = "fragment absent: <urlset") => ({
    verifie_le: `2026-10-25 10:${String(minute).padStart(2, "0")}:00`,
    check_libelle,
    erreur,
  });

  it("fusionne les incidents identiques consecutifs, du plus recent au plus ancien", () => {
    const groupes = regrouperIncidents([
      incident(9, "robots.txt", "statut HTTP 502"),
      incident(5),
      incident(4),
      incident(3),
      incident(1, "robots.txt", "statut HTTP 502"),
    ]);
    expect(groupes.map((g) => [g.check_libelle, g.nombre, heure(g.debut), heure(g.fin)])).toEqual([
      ["robots.txt", 1, "10:09", "10:09"],
      ["Sitemap (index)", 3, "10:03", "10:05"],
      ["robots.txt", 1, "10:01", "10:01"],
    ]);
  });

  it("separe deux erreurs differentes du meme check", () => {
    expect(regrouperIncidents([incident(2, "A", "x"), incident(1, "A", "y")])).toHaveLength(2);
    expect(regrouperIncidents([])).toEqual([]);
  });
});

describe("tonDisponibilite", () => {
  it("passe du vert a l'orange puis au rouge", () => {
    expect(tonDisponibilite(99.5)).toBe("revenu");
    expect(tonDisponibilite(95.3)).toBe("alerte");
    expect(tonDisponibilite(80)).toBe("depense");
    expect(tonDisponibilite(null)).toBe("neutre");
  });
});

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
      'Sitemap (index) — https://denivio.fr/sitemap.xml — 3x "<sitemap>" — OK : HTTP 200 à 10:02 — 106 ms',
    );
    expect(texteCheck({ libelle: "Neuf", url: "https://x.fr" })).toBe("Neuf — https://x.fr — jamais vérifié");
  });
});
