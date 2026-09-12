import { describe, expect, it } from "vitest";
import { PERIODES, PERIODE_DEFAUT } from "./periodes";
import { periodeValide, siteEnPreference, siteValide } from "./preferencesTableau";

const SITES = [{ id: 1, nom: "Denivio" }, { id: 2, nom: "HistorySite" }];

describe("periodeValide", () => {
  it("accepte chaque periode proposee", () => {
    for (const { cle } of PERIODES) {
      expect(periodeValide(cle)).toBe(cle);
    }
  });

  it("retombe sur le defaut pour une valeur inconnue", () => {
    // Cas concret: une periode enregistree par une version anterieure
    expect(periodeValide("trimestre")).toBe(PERIODE_DEFAUT);
    expect(periodeValide("")).toBe(PERIODE_DEFAUT);
    expect(periodeValide(null)).toBe(PERIODE_DEFAUT);
  });
});

describe("siteValide", () => {
  it("restitue un site qui existe encore", () => {
    expect(siteValide("2", SITES)).toBe(2);
  });

  it("revient a tous les sites quand le site memorise a ete supprime", () => {
    // Sinon le tableau de bord filtrerait sur un identifiant fantome: aucun
    // chiffre affiche, et rien pour comprendre pourquoi.
    expect(siteValide("42", SITES)).toBeNull();
  });

  it("traite l'absence de preference comme tous les sites", () => {
    expect(siteValide("", SITES)).toBeNull();
    expect(siteValide(null, SITES)).toBeNull();
    expect(siteValide(undefined, SITES)).toBeNull();
  });

  it("rejette une valeur qui n'est pas un identifiant", () => {
    expect(siteValide("abc", SITES)).toBeNull();
    expect(siteValide("1.5", SITES)).toBeNull();
  });

  it("revient a tous les sites quand il n'y a plus aucun site", () => {
    expect(siteValide("1", [])).toBeNull();
  });
});

describe("siteEnPreference", () => {
  it("represente tous les sites par une chaine vide", () => {
    expect(siteEnPreference(null)).toBe("");
    expect(siteEnPreference(undefined)).toBe("");
  });

  it("fait l'aller-retour avec siteValide", () => {
    for (const site of SITES) {
      expect(siteValide(siteEnPreference(site.id), SITES)).toBe(site.id);
    }
    expect(siteValide(siteEnPreference(null), SITES)).toBeNull();
  });
});
