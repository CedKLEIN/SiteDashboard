import { describe, expect, it } from "vitest";
import { groupesParSite, manquesParSite } from "./reglagesAgents";

const controles = [
  { id: "seo-h", modele: "seo", siteCle: "histoire", site: "roisempereurs.fr" },
  { id: "seo-d", modele: "seo", siteCle: "denivio", site: "denivio.fr" },
  { id: "bing-d", modele: "bing", siteCle: "denivio", site: "denivio.fr" },
];

describe("reglages des agents par site", () => {
  it("regroupe les taches par fiche de site, avec le nom et la couleur du tableau de bord", () => {
    const sites = [{ id: 1, nom: "Denivio", url: "https://www.denivio.fr", couleur: "#0f0" }];
    const groupes = groupesParSite(controles, sites);
    expect(groupes.map((g) => [g.nom, g.controles.map((c) => c.id)])).toEqual([
      ["Denivio", ["seo-d", "bing-d"]],
      ["roisempereurs.fr", ["seo-h"]],
    ]);
    expect(groupes[0]).toMatchObject({ couleur: "#0f0" });
  });

  it("ce que les autres sites ont et pas celui-ci, sauf modele inapplicable", () => {
    const modeles = [
      { id: "seo", titre: "SEO", sites: [{ cle: "histoire", deja: true, manquants: [] }, { cle: "denivio", deja: true, manquants: [] }] },
      { id: "bing", titre: "Bing", sites: [{ cle: "histoire", deja: false, manquants: ["projet"] }, { cle: "denivio", deja: true, manquants: [] }] },
      { id: "audit", titre: "Audit", sites: [{ cle: "histoire", deja: false, manquants: [] }] },
    ];
    const manques = manquesParSite(controles, modeles);
    expect(manques.get("histoire")).toEqual([{ id: "bing", titre: "Bing", description: undefined, siteCle: "histoire", manquants: ["projet"] }]);
    expect(manques.get("denivio")).toEqual([]);
  });
});
