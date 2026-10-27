import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));

const { default: Agents } = await import("./Agents");

const SITES = [
  { id: 1, nom: "Denivio", url: "https://denivio.fr", couleur: "#22c55e" },
  { id: 2, nom: "HistorySite", url: "https://roisempereurs.fr", couleur: "#6366f1" },
];

const MODELES = [
  { id: "indexation-seo", titre: "SEO Google + Bing", type: "claude", sites: [{ cle: "denivio", deja: true, manquants: [] }, { cle: "histoire", deja: true, manquants: [] }] },
  { id: "bing", titre: "Bing : soumission et suivi", description: "Par l'API de Bing", type: "script", sites: [{ cle: "denivio", deja: true, manquants: [] }, { cle: "histoire", deja: false, manquants: [] }] },
];

function controles(surcharges = {}) {
  return {
    controles: [
      { id: "seo-denivio", modele: "indexation-seo", siteCle: "denivio", site: "denivio.fr", titre: "SEO Google", type: "claude", cron: "0 9 * * *", cronParDefaut: "0 9 * * *", actif: true },
      { id: "bing-denivio", modele: "bing", siteCle: "denivio", site: "denivio.fr", titre: "Bing : soumission et suivi", type: "script", cron: "0 9 * * *", cronParDefaut: "0 9 * * *", actif: true },
      { id: "seo-histoire", modele: "indexation-seo", siteCle: "histoire", site: "roisempereurs.fr", titre: "SEO Google + Bing", type: "claude", cron: "0 9 * * *", cronParDefaut: "0 9 * * *", actif: false },
    ],
    modeles: MODELES,
    derniers: {},
    resultats: {},
    enCours: {},
    erreurRegistre: null,
    lancer: vi.fn(),
    activer: vi.fn(),
    ajouter: vi.fn(() => Promise.resolve()),
    retirer: vi.fn(),
    modifierHoraire: vi.fn(),
    ...surcharges,
  };
}

afterEach(cleanup);

describe("onglet Agents : les reglages, site par site", () => {
  it("une section par site, avec ses taches et leur interrupteur", () => {
    const c = controles();
    render(<Agents sites={SITES} controles={c} />);
    const denivio = screen.getByRole("heading", { name: "Denivio" }).closest("section");
    expect(within(denivio).getByText("SEO Google")).toBeTruthy();
    expect(within(denivio).getByText("Bing : soumission et suivi")).toBeTruthy();

    const histoire = screen.getByRole("heading", { name: "HistorySite" }).closest("section");
    const interrupteur = within(histoire).getByRole("switch", { name: /SEO Google \+ Bing/ });
    expect(interrupteur.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(interrupteur);
    expect(c.activer).toHaveBeenCalledWith("seo-histoire", true);
  });

  it("propose d'aligner un site sur les autres : la tache Bing en un clic", () => {
    const c = controles();
    render(<Agents sites={SITES} controles={c} />);
    const histoire = screen.getByRole("heading", { name: "HistorySite" }).closest("section");
    fireEvent.click(within(histoire).getByRole("button", { name: /Bing : soumission et suivi/ }));
    expect(c.ajouter).toHaveBeenCalledWith("bing", "histoire");
    // Denivio a deja tout
    const denivio = screen.getByRole("heading", { name: "Denivio" }).closest("section");
    expect(within(denivio).queryByText("Les autres sites ont aussi :")).toBeNull();
  });

  it("previent quand les horaires des taches sont introuvables", () => {
    render(<Agents sites={SITES} controles={controles()} configTrouvee={false} />);
    expect(screen.getByText(/Horaires des tâches planifiées introuvables/)).toBeTruthy();
  });

  it("montre le registre illisible au lieu d'une page vide", () => {
    render(<Agents sites={SITES} controles={controles({ controles: [], erreurRegistre: "JSON invalide" })} />);
    expect(screen.getByText(/JSON invalide/)).toBeTruthy();
  });
});
