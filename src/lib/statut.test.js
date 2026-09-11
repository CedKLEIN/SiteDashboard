import { describe, expect, it } from "vitest";
import { etatSite, evaluerCertificat, libelleEtat, tauxDisponibilite } from "./statut";

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

describe("evaluerCertificat", () => {
  it("valide un certificat largement au-dessus du seuil", () => {
    expect(evaluerCertificat({ jours_restants: 68 }, 21)).toEqual({
      ok: true,
      message: "valide encore 68 jour(s)",
    });
  });

  it("alerte AVANT l'expiration, pas apres", () => {
    // Tout l'interet du check: 10 jours restants n'est pas encore une panne,
    // mais c'en est une programmee.
    const verdict = evaluerCertificat({ jours_restants: 10 }, 21);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toBe("certificat expire dans 10 jour(s)");
  });

  it("traite le seuil comme inclusif", () => {
    expect(evaluerCertificat({ jours_restants: 21 }, 21).ok).toBe(false);
    expect(evaluerCertificat({ jours_restants: 22 }, 21).ok).toBe(true);
  });

  it("annonce depuis combien de temps un certificat est expire", () => {
    expect(evaluerCertificat({ jours_restants: -3 }, 21)).toEqual({
      ok: false,
      message: "certificat expire depuis 3 jour(s)",
    });
  });

  it("remonte l'erreur reseau telle quelle", () => {
    expect(evaluerCertificat({ erreur: "connexion impossible" })).toEqual({
      ok: false,
      message: "connexion impossible",
    });
  });

  it("echoue proprement sur un resultat vide", () => {
    expect(evaluerCertificat().ok).toBe(false);
    expect(evaluerCertificat({}).message).toBe("certificat illisible");
  });
});
