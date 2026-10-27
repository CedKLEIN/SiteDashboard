import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./trace", () => ({ tracer: vi.fn() }));

const { avancementMiseAJour, commitCourt, resumeMiseAJour } = await import("./miseAJour");

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
    // Pousses d'ailleurs : la mise a jour les recupere d'abord
    expect(resumeMiseAJour({ nouveaux: ["a", "b", "c"], a_recuperer: 2 }).libelle).toBe("3 nouveaux commits (dont 2 à récupérer)");
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

describe("avancementMiseAJour", () => {
  const JOURNAL = [
    "",
    "> site-dashboard@0.1.0 installer",
    "> node scripts/installer.mjs",
    "",
    "==> Compilation de la nouvelle version (quelques minutes)",
    "> site-dashboard@0.1.0 app:build",
    "   Compiling site-dashboard v0.1.0",
  ].join("\r\n");

  it("l'etape en cours est la derniere du script, pas une ligne de npm", () => {
    expect(avancementMiseAJour(JOURNAL)).toEqual({ etape: "Compilation de la nouvelle version (quelques minutes)", echec: false, fin: "" });
    expect(avancementMiseAJour("").etape).toBe("Démarrage");
  });

  it("un echec montre la fin de la sortie, sans la marque", () => {
    const r = avancementMiseAJour(`${JOURNAL}\r\nerror: could not compile\r\nMISE_A_JOUR_ECHEC \r\n`);
    expect(r.echec).toBe(true);
    expect(r.fin.split("\n").at(-1)).toBe("error: could not compile");
    expect(r.fin).not.toContain("MISE_A_JOUR_ECHEC");
  });
});
