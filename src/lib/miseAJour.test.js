import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./trace", () => ({ tracer: vi.fn() }));

const { commitCourt, resumeMiseAJour } = await import("./miseAJour");

describe("resumeMiseAJour", () => {
  it("ne propose la mise a jour que s'il y a des commits plus recents", () => {
    expect(resumeMiseAJour({ nouveaux: [], modifications_locales: 3 })).toEqual({
      disponible: false,
      libelle: "À jour",
    });
    expect(resumeMiseAJour({ nouveaux: ["abc Corrige X"] })).toEqual({
      disponible: true,
      libelle: "1 nouveau commit",
    });
    expect(resumeMiseAJour({ nouveaux: ["a", "b", "c"] }).libelle).toBe("3 nouveaux commits");
  });

  it("dit pourquoi la verification n'a pas pu se faire", () => {
    expect(resumeMiseAJour({ erreur: "git introuvable", nouveaux: [] })).toEqual({
      disponible: false,
      libelle: "Vérification impossible : git introuvable",
    });
    expect(resumeMiseAJour(null).disponible).toBe(false);
  });

  it("raccourcit un commit", () => {
    expect(commitCourt("3b08773fd2a1")).toBe("3b08773");
    expect(commitCourt("")).toBe("inconnu");
  });
});
