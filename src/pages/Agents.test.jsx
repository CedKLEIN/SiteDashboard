import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args) => invoke(...args) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn(() => Promise.resolve()) }));

const { default: Agents } = await import("./Agents");

const RACINE = "C:\\Users\\moi\\.claude\\rapports-agents";

function fichier(jour, agent, donnees) {
  return {
    chemin: `${RACINE}\\denivio.fr\\${jour}\\${agent}.json`,
    contenu: JSON.stringify({ site: "denivio.fr", date: jour, agent, ...donnees }),
    erreur: null,
  };
}

const SITES = [{ id: 1, nom: "Denivio", url: "https://denivio.fr", couleur: "#22c55e" }];

afterEach(() => {
  cleanup();
  invoke.mockReset();
});

describe("page Agents", () => {
  it("affiche une ligne par jour avec son verdict, et les rapports au clic", async () => {
    invoke.mockResolvedValue({
      dossier: RACINE,
      existe: true,
      fichiers: [
        fichier("2026-10-24", "sante", { titre: "Sante de la prod", statut: "ok", resume: "RAS" }),
        fichier("2026-10-24", "seo", {
          titre: "Indexation",
          statut: "attention",
          resume: "Quota Google atteint",
          points: [{ niveau: "attention", texte: "7 avertissements Bing" }],
        }),
        fichier("2026-10-23", "sante", { titre: "Sante de la prod", statut: "echec" }),
      ],
    });

    render(<Agents sites={SITES} rafraichissement={0} />);

    const lignes = await screen.findAllByRole("button", { expanded: false });
    expect(lignes).toHaveLength(2);
    // La plus recente d'abord, verdict porte par le titre (et l'icone)
    expect(lignes[0].getAttribute("title")).toMatch(/^Partiel/);
    expect(lignes[1].getAttribute("title")).toMatch(/^KO/);
    expect(lignes[0].textContent).toContain("Denivio");
    expect(lignes[0].textContent).toContain("2 rapport(s) · 1 OK · 1 a regarder");

    expect(screen.queryByText("Quota Google atteint")).toBeNull();
    fireEvent.click(lignes[0]);
    expect(screen.getByText("Quota Google atteint")).toBeTruthy();
    expect(screen.getByText("7 avertissements Bing")).toBeTruthy();
    expect(screen.getByText("Sante de la prod")).toBeTruthy();
  });

  it("demande les rapports depuis la date de debut d'historique", async () => {
    invoke.mockResolvedValue({ dossier: RACINE, existe: false, fichiers: [] });
    render(<Agents sites={SITES} rafraichissement={0} />);
    expect(await screen.findByText("Aucun agent n'a encore depose de rapport.")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("lire_rapports_agents", {
      depuis: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  it("montre l'erreur de lecture au lieu d'une page vide", async () => {
    invoke.mockRejectedValue("acces refuse");
    render(<Agents sites={SITES} rafraichissement={0} />);
    expect(await screen.findByText(/acces refuse/)).toBeTruthy();
  });
});
