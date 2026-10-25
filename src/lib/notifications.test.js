import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(() => Promise.resolve(true)),
  requestPermission: vi.fn(() => Promise.resolve("granted")),
  sendNotification: vi.fn(),
}));
vi.mock("./trace", () => ({ tracer: vi.fn() }));

const { changements, creerSuivi, elementsAgents, elementsSites } = await import("./notifications");
const { sendNotification } = await import("@tauri-apps/plugin-notification");

function site(nb_ok, nb_resultats = 3) {
  return { id: 1, nom: "Denivio", nb_checks: nb_resultats, nb_resultats, nb_ok };
}

describe("changements", () => {
  it("n'alerte qu'a l'entree dans un mauvais etat, et annonce le retour", () => {
    let etat = changements(elementsSites([site(3)]));
    expect(etat.aEnvoyer).toEqual([]);

    etat = changements(elementsSites([site(2)]), etat.suivant);
    expect(etat.aEnvoyer.map((n) => n.titre)).toEqual(["Denivio : un check échoue"]);
    expect(etat.aEnvoyer[0].corps).toBe("1 check(s) en échec sur 3.");

    // Toujours en echec au cycle suivant : rien de nouveau
    etat = changements(elementsSites([site(2)]), etat.suivant);
    expect(etat.aEnvoyer).toEqual([]);

    // Aggravation : renotifie
    etat = changements(elementsSites([site(0)]), etat.suivant);
    expect(etat.aEnvoyer.map((n) => n.titre)).toEqual(["Denivio est en panne"]);

    etat = changements(elementsSites([site(3)]), etat.suivant);
    expect(etat.aEnvoyer.map((n) => n.titre)).toEqual(["Denivio est revenu"]);
  });

  it("ne dit rien d'un site jamais verifie", () => {
    const inconnu = { id: 2, nom: "X", nb_checks: 2, nb_resultats: 0, nb_ok: 0 };
    expect(changements(elementsSites([inconnu])).aEnvoyer).toEqual([]);
  });

  it("alerte sur un agent bloque, pas lance ou en echec, sans annoncer son retour", () => {
    const agent = (situation, rapport = null) => ({
      id: "sante",
      titre: "Santé",
      site: "denivio.fr",
      situation,
      message: "Lancé à 09:04",
      rapport,
    });
    let etat = changements(elementsAgents([agent("bloque")]));
    expect(etat.aEnvoyer.map((n) => n.titre)).toEqual(["Agent bloqué : Santé (denivio.fr)"]);

    etat = changements(elementsAgents([agent("recu", { statut: "ok" })]), etat.suivant);
    expect(etat.aEnvoyer).toEqual([]);

    etat = changements(elementsAgents([agent("recu", { statut: "echec", resume: "Sentry non lu" })]));
    expect(etat.aEnvoyer).toEqual([{ titre: "Agent en échec : Santé (denivio.fr)", corps: "Sentry non lu" }]);
  });
});

describe("creerSuivi", () => {
  it("envoie les changements, et suit l'etat meme notifications coupees", async () => {
    const notifier = creerSuivi();
    await notifier(elementsSites([site(0)]), false);
    expect(sendNotification).not.toHaveBeenCalled();

    // Deja connu pendant la coupure : pas de rattrapage a la reactivation
    await notifier(elementsSites([site(0)]), true);
    expect(sendNotification).not.toHaveBeenCalled();

    await notifier(elementsSites([site(3)]), true);
    expect(sendNotification).toHaveBeenCalledWith({
      title: "Denivio est revenu",
      body: "Tous ses checks repassent au vert.",
    });
  });
});
