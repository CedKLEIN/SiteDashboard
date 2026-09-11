import { describe, expect, it } from "vitest";
import { etatSite, libelleEtat, tauxDisponibilite } from "./statut";

describe("etatSite", () => {
  it("est vert quand tous les checks passent", () => {
    expect(etatSite({ nb_checks: 3, nb_resultats: 3, nb_ok: 3 })).toBe("ok");
  });

  it("est orange quand une partie seulement echoue", () => {
    expect(etatSite({ nb_checks: 3, nb_resultats: 3, nb_ok: 2 })).toBe("partiel");
  });

  it("est rouge quand tout echoue", () => {
    expect(etatSite({ nb_checks: 2, nb_resultats: 2, nb_ok: 0 })).toBe("ko");
  });

  it("distingue un site sans check d'un site jamais verifie", () => {
    expect(etatSite({ nb_checks: 0, nb_resultats: 0, nb_ok: 0 })).toBe("aucun");
    expect(etatSite({ nb_checks: 2, nb_resultats: 0, nb_ok: 0 })).toBe("inconnu");
  });

  it("ne passe pas en alerte pour un check qui n'a pas encore tourne", () => {
    // 2 checks, un seul a un resultat, et il est bon: le site reste vert
    expect(etatSite({ nb_checks: 2, nb_resultats: 1, nb_ok: 1 })).toBe("ok");
  });

  it("tolere une entree vide", () => {
    expect(etatSite()).toBe("aucun");
    expect(libelleEtat("etat-inexistant")).toBe("Jamais verifie");
  });
});

describe("tauxDisponibilite", () => {
  it("calcule le pourcentage de reussite", () => {
    expect(tauxDisponibilite([{ ok: 1 }, { ok: 1 }, { ok: 0 }, { ok: 1 }])).toBe(75);
  });

  it("renvoie null sans donnee, plutot que 0 ou NaN", () => {
    expect(tauxDisponibilite([])).toBeNull();
    expect(tauxDisponibilite(undefined)).toBeNull();
  });
});
