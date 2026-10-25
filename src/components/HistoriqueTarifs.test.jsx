import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const ajouterTarif = vi.fn(() => Promise.resolve());
const supprimerTarif = vi.fn(() => Promise.resolve());
vi.mock("../lib/queries", () => ({
  ajouterTarif: (...args) => ajouterTarif(...args),
  majTarif: vi.fn(() => Promise.resolve()),
  supprimerTarif: (...args) => supprimerTarif(...args),
}));

const { default: HistoriqueTarifs } = await import("./HistoriqueTarifs");

const ABONNEMENT = { id: 3, devise: "EUR" };
const TARIF = { id: 10, abonnement_id: 3, debut: "2025-07-29", montant_cents: 1080 };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function monter(tarifs = [TARIF]) {
  const props = { onModifie: vi.fn(), onErreur: vi.fn() };
  render(<HistoriqueTarifs abonnement={ABONNEMENT} tarifs={tarifs} {...props} />);
  return props;
}

describe("HistoriqueTarifs", () => {
  it("ajoute un nouveau tarif et previent la page", async () => {
    const { onModifie } = monter();
    fireEvent.change(screen.getByLabelText("Nouveau montant (€)"), { target: { value: "12,50" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter ce tarif" }));

    await waitFor(() => expect(onModifie).toHaveBeenCalled());
    expect(ajouterTarif).toHaveBeenCalledWith(3, {
      debut: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      montantCents: 1250,
    });
  });

  it("refuse un montant invalide", async () => {
    const { onErreur, onModifie } = monter();
    fireEvent.change(screen.getByLabelText("Nouveau montant (€)"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter ce tarif" }));

    await waitFor(() => expect(onErreur).toHaveBeenCalledWith("Nouveau tarif invalide."));
    expect(ajouterTarif).not.toHaveBeenCalled();
    expect(onModifie).not.toHaveBeenCalled();
  });

  it("garde toujours au moins un tarif", async () => {
    const { onErreur } = monter();
    fireEvent.click(screen.getByTitle("Supprimer ce tarif"));
    await waitFor(() =>
      expect(onErreur).toHaveBeenCalledWith("Un abonnement doit garder au moins un tarif."),
    );
    expect(supprimerTarif).not.toHaveBeenCalled();
  });
});
