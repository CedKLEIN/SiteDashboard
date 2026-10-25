import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const creerCheck = vi.fn(() => Promise.resolve({ lastInsertId: 1 }));
vi.mock("../lib/queries", () => ({ creerCheck: (...args) => creerCheck(...args) }));

const { default: FormulaireCheck } = await import("./FormulaireCheck");

afterEach(() => {
  cleanup();
  creerCheck.mockClear();
});

function champ(libelle) {
  // Le libelle « Chemin » englobe aussi l'URL du site affichee devant le champ
  return screen.getByLabelText(libelle === "Chemin" ? /^Chemin/ : libelle);
}

describe("FormulaireCheck", () => {
  it("refuse un site sans URL", async () => {
    render(<FormulaireCheck site={{ id: 1, url: null }} />);
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un check" }));
    expect(await screen.findByText(/Ce site n'a pas d'URL/)).toBeTruthy();
    expect(creerCheck).not.toHaveBeenCalled();
  });

  it("cree un check HTTP avec ses assertions et previent l'ecran", async () => {
    const onAjoute = vi.fn();
    render(<FormulaireCheck site={{ id: 3, url: "https://denivio.fr/" }} onAjoute={onAjoute} />);

    fireEvent.change(champ("Libellé"), { target: { value: "Sitemap 1" } });
    fireEvent.change(champ("Chemin"), { target: { value: "/sitemap-1.xml" } });
    fireEvent.change(champ("Doit contenir"), { target: { value: "<loc>" } });
    fireEvent.change(champ("Occurrences min"), { target: { value: "45000" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un check" }));

    await waitFor(() => expect(onAjoute).toHaveBeenCalled());
    expect(creerCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: 3,
        libelle: "Sitemap 1",
        url: "https://denivio.fr/sitemap-1.xml",
        type: "http",
        doitContenir: "<loc>",
        occurrencesMin: 45000,
        tailleMinOctets: null,
        entetes: [],
      }),
    );
    // Le formulaire repart a vide
    expect(champ("Libellé").value).toBe("");
  });

  it("exige la cible d'une redirection", async () => {
    render(<FormulaireCheck site={{ id: 3, url: "https://denivio.fr/" }} />);
    fireEvent.change(champ("Type"), { target: { value: "redirection" } });
    fireEvent.change(champ("Chemin"), { target: { value: "/" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un check" }));
    expect(await screen.findByText("Indique vers quelle URL rediriger.")).toBeTruthy();
    expect(creerCheck).not.toHaveBeenCalled();
  });
});
