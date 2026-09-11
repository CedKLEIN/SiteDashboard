import { describe, expect, it } from "vitest";
import { formaterRapport } from "./rapport";

const CHECK = {
  libelle: "Configuration runtime",
  type: "http",
  url: "https://roisempereurs.fr/config.js",
  doit_contenir: "window.",
  actif: 1,
  derniere_verif: "2026-09-11 22:30:00",
  dernier_ok: 0,
  dernier_statut: 404,
  derniere_latence: 38,
  derniere_erreur: "statut HTTP 404",
};

const INSPECTION = {
  methode: "GET",
  url_demandee: "https://roisempereurs.fr/config.js",
  entetes_requete: [["user-agent", "SiteDashboard/0.1.0"]],
  redirections: [],
  statut: 404,
  statut_texte: "Not Found",
  version_http: "HTTP/2.0",
  entetes_reponse: [
    ["content-type", "text/html"],
    ["server", "nginx/1.18.0 (Ubuntu)"],
  ],
  content_type: "text/html",
  taille: 153,
  duree_ms: 42,
  url_finale: "https://roisempereurs.fr/config.js",
  extrait: "<html>\n<head><title>404 Not Found</title></head>",
  tronque: false,
  certificat: { jours_restants: 68, expire_le: "Nov 18 2026", emetteur: "CN=R11" },
};

describe("formaterRapport", () => {
  it("raconte l'histoire dans le sens du debogage", () => {
    const rapport = formaterRapport({
      check: CHECK,
      inspection: INSPECTION,
      site: { nom: "HistorySite" },
    });

    const ordre = ["Check configuré", "Requête envoyée", "Réponse", "Corps de la réponse"];
    const positions = ordre.map((titre) => rapport.indexOf(titre));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("contient les informations qui expliquent l'echec", () => {
    const rapport = formaterRapport({
      check: CHECK,
      inspection: INSPECTION,
      site: { nom: "HistorySite" },
    });

    expect(rapport).toContain("404 Not Found");
    expect(rapport).toContain("content-type: text/html");
    expect(rapport).toContain("Doit contenir: window.");
    expect(rapport).toContain("server: nginx/1.18.0 (Ubuntu)");
  });

  it("inclut le certificat quand il a pu etre lu", () => {
    const rapport = formaterRapport({ check: CHECK, inspection: INSPECTION });
    expect(rapport).toContain("Certificat TLS");
    expect(rapport).toContain("Jours restants: 68");
  });

  it("omet le certificat quand sa lecture a echoue", () => {
    const rapport = formaterRapport({
      check: CHECK,
      inspection: { ...INSPECTION, certificat: { erreur: "connexion impossible" } },
    });
    expect(rapport).not.toContain("Certificat TLS");
  });

  it("liste les redirections quand il y en a", () => {
    const rapport = formaterRapport({
      check: CHECK,
      inspection: {
        ...INSPECTION,
        redirections: ["301 http://exemple.fr -> https://exemple.fr"],
      },
    });
    expect(rapport).toContain("Redirections suivies");
    expect(rapport).toContain("301 http://exemple.fr -> https://exemple.fr");
  });

  it("n'invente pas de section redirection quand il n'y en a pas", () => {
    const rapport = formaterRapport({ check: CHECK, inspection: INSPECTION });
    expect(rapport).not.toContain("Redirections suivies");
  });

  it("signale un corps tronque plutot que de faire croire a un corps complet", () => {
    const rapport = formaterRapport({
      check: CHECK,
      inspection: { ...INSPECTION, tronque: true, taille: 99999 },
    });
    expect(rapport).toContain("tronqué");
    expect(rapport).toContain("99999");
  });

  it("reste exploitable sans inspection", () => {
    const rapport = formaterRapport({ check: CHECK, inspection: null });
    expect(rapport).toContain("Check configuré");
    expect(rapport).toContain("aucune inspection");
  });

  it("n'affiche pas les champs vides", () => {
    const rapport = formaterRapport({
      check: { libelle: "Nu", url: "https://x.fr" },
      inspection: null,
    });
    expect(rapport).not.toContain("Seuil certificat");
    expect(rapport).not.toContain("Site:");
  });
});
