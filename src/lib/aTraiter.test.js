import { describe, expect, it } from "vitest";
import { construireATraiter, dureeCourte, nbATraiter, quandEcheance } from "./aTraiter";

const maintenant = new Date(2026, 9, 27, 14, 20);

describe("a traiter", () => {
  it("rassemble checks en echec, points d'agents et prelevements proches, pannes d'abord", () => {
    const liste = construireATraiter({
      aujourdhui: "2026-10-27",
      maintenant,
      echeances: [
        { id: 1, libelle: "VPS", fournisseur_nom: "OVH", montant_cents: 1199, prochaine_echeance: "2026-10-28" },
        { id: 2, libelle: "Domaine", montant_cents: 1100, prochaine_echeance: "2026-12-01" },
      ],
      vuesAgents: [{ cle: "denivio.fr", siteId: 1, nom: "Denivio", aFaire: [{ id: "seo", niveau: "attention", tache: "SEO", court: "3 pages non indexées", texte: "3 pages non indexées" }] }],
      echecs: [
        { id: 7, site_id: 2, site_nom: "HistorySite", libelle: "Santé de l'API", type: "http", statut_http: 503, erreur: null, depuis: "2026-10-27 14:08:00" },
        { id: 8, site_id: 4, site_nom: "SiteWatcher", libelle: "Certificat TLS", type: "tls", jours_restants: 9, erreur: "certificat expire dans 9 jour(s)", depuis: "2026-10-20 09:00:00" },
      ],
    });
    expect(liste.map((x) => [x.ton, x.titre, x.detail.replace(/\s/g, " ")])).toEqual([
      ["ko", "HistorySite · Santé de l'API", "HTTP 503 · depuis 12 min"],
      ["alerte", "SiteWatcher · Certificat TLS", "certificat expire dans 9 jour(s) · depuis 7 j"],
      ["alerte", "Denivio · SEO", "3 pages non indexées"],
      ["info", "VPS · OVH", "Prélèvement de 11,99 € demain"],
    ]);
    expect(liste[0].cible).toEqual({ page: "site", siteId: 2, onglet: "sante" });
    expect(nbATraiter(liste)).toBe(3);
  });

  it("dit quand tombe un prelevement et depuis quand dure un echec", () => {
    expect(quandEcheance("2026-10-27", "2026-10-27")).toBe("aujourd'hui");
    expect(quandEcheance("2026-11-10", "2026-10-27")).toBe("dans 14 j");
    expect(dureeCourte(190)).toBe("3 h");
    expect(dureeCourte(3000)).toBe("2 j");
  });
});
