import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { dateDepuis } from "../lib/rapportsAgents";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args) => invoke(...args) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn(() => Promise.resolve()) }));
const writeText = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: (...args) => writeText(...args) }));

const { default: Agents } = await import("./Agents");

const RACINE = "C:\\Users\\moi\\.claude\\rapports-agents";
const AUJOURDHUI = dateDepuis(0);
const HIER = dateDepuis(1);

function fichier(site, jour, agent, donnees) {
  return {
    chemin: `${RACINE}\\${site}\\${jour}\\${agent}.json`,
    contenu: JSON.stringify({ site, date: jour, agent, ...donnees }),
    erreur: null,
  };
}

const SITES = [
  { id: 1, nom: "Denivio", url: "https://denivio.fr", couleur: "#22c55e" },
  { id: 2, nom: "Rois & Empereurs", url: "https://roisempereurs.fr", couleur: "#6366f1" },
];

const FICHIERS = [
  fichier("denivio.fr", AUJOURDHUI, "indexation", {
    titre: "Indexation Google",
    statut: "echec",
    debut: `${AUJOURDHUI}T09:12:00+01:00`,
    fin: `${AUJOURDHUI}T09:20:00+01:00`,
    resume: "Extension Chrome déconnectée.",
    points: [
      { niveau: "echec", texte: "Reconnecter l'extension Claude in Chrome" },
      { niveau: "attention", texte: "/catalogs/col-de-montgenevre répond 404" },
    ],
  }),
  fichier("denivio.fr", HIER, "indexation", { titre: "Indexation Google", statut: "ok", resume: "8 demandes" }),
  fichier("denivio.fr", AUJOURDHUI, "sante", { titre: "Santé de la prod", statut: "ok", resume: "RAS" }),
  fichier("roisempereurs.fr", AUJOURDHUI, "sante-r", { titre: "Santé de la prod", statut: "ok", resume: "RAS" }),
];

afterEach(() => {
  cleanup();
  invoke.mockReset();
  writeText.mockClear();
});

describe("page Agents par site", () => {
  it("une carte par site : le site qui demande une action d'abord, avec son resume", async () => {
    invoke.mockResolvedValue({ dossier: RACINE, existe: true, fichiers: FICHIERS });
    render(<Agents sites={SITES} rafraichissement={0} />);

    const denivio = await screen.findByRole("button", { name: /Denivio/ });
    const cartes = screen.getAllByRole("button", { name: /Denivio|Rois & Empereurs/ });
    expect(cartes[0]).toBe(denivio);
    expect(denivio.textContent).toContain("Action requise");
    expect(denivio.textContent).toContain("Indexation Google : Extension Chrome déconnectée.");
    expect(denivio.textContent).toContain("1 autre(s) OK.");
    expect(cartes[1].textContent).toContain("Tout va bien");
    // Le detail n'est pas montre avant le clic
    expect(screen.queryByText("/catalogs/col-de-montgenevre répond 404")).toBeNull();
  });

  it("un clic sur le site : ce qu'il y a a faire, puis ses taches ; un clic sur une tache : ses rapports", async () => {
    invoke.mockResolvedValue({ dossier: RACINE, existe: true, fichiers: FICHIERS });
    render(<Agents sites={SITES} rafraichissement={0} />);
    fireEvent.click(await screen.findByRole("button", { name: /Denivio/ }));

    const aFaire = screen.getByText("À faire").closest("div").parentElement;
    expect(within(aFaire).getByText("Reconnecter l'extension Claude in Chrome")).toBeTruthy();
    expect(within(aFaire).getByText("/catalogs/col-de-montgenevre répond 404")).toBeTruthy();

    const tache = screen.getByRole("button", { name: /Indexation Google/, expanded: false });
    expect(tache.textContent).toContain("Échec");
    fireEvent.click(tache);
    // Le dernier passage est ouvert, avec son heure et sa duree ; les autres sont replies
    expect(screen.getByText("Extension Chrome déconnectée.")).toBeTruthy();
    expect(screen.getByText(/lancé à 09:12 · 8 min/)).toBeTruthy();
    expect(screen.queryByText("8 demandes")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /hier|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche/i, expanded: false }));
    expect(screen.getByText("8 demandes")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Copier ce rapport" })[0]);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Indexation Google — denivio.fr"));

    // Retour aux cartes
    fireEvent.click(screen.getByRole("button", { name: /Denivio/ }));
    expect(screen.getByRole("button", { name: /Rois & Empereurs/ })).toBeTruthy();
  });

  it("une tache bloquee sans rapport est une action, avec son message", async () => {
    invoke.mockResolvedValue({ dossier: RACINE, existe: true, fichiers: [] });
    const attendus = [
      {
        id: "sante",
        agent: "sante",
        site: "denivio.fr",
        titre: "Santé de la prod",
        situation: "bloque",
        message: "Lancé à 09:04, toujours sans rapport après 1 h",
        rapport: null,
      },
    ];
    render(<Agents sites={SITES} rafraichissement={0} attendus={attendus} />);
    const carte = await screen.findByRole("button", { name: /Denivio/ });
    expect(carte.textContent).toContain("Action requise");
    fireEvent.click(carte);
    expect(screen.getByText("Lancé à 09:04, toujours sans rapport après 1 h")).toBeTruthy();
    expect(screen.getByText("Bloquée ?")).toBeTruthy();
  });

  it("une tache lancee depuis l'appli se montre en cours, avec un carre bleu de plus", async () => {
    invoke.mockResolvedValue({ dossier: RACINE, existe: true, fichiers: FICHIERS });
    const controles = {
      controles: [{ id: "sante", site: "denivio.fr", titre: "Santé de la prod", cron: "45 7 * * *", type: "script" }],
      modeles: [],
      derniers: {},
      resultats: {},
      enCours: { script: "sante", claude: null },
      erreurRegistre: null,
      lancer: vi.fn(),
    };
    render(<Agents sites={SITES} rafraichissement={0} controles={controles} />);
    fireEvent.click(await screen.findByRole("button", { name: /Denivio/ }));
    const ligne = screen.getByRole("button", { name: /Santé de la prod/, expanded: false });
    expect(ligne.textContent).toContain("En cours");
    expect(within(ligne).getByTitle("En cours").style.background).toBe("rgb(56, 189, 248)");
  });

  it("une tache hors du registre peut perdre son historique, apres confirmation", async () => {
    let fichiers = FICHIERS;
    invoke.mockImplementation(async (commande, args) => {
      if (commande === "supprimer_rapports_agent") {
        fichiers = fichiers.filter((f) => !f.chemin.endsWith(`\\${args.agent}.json`));
        return 2;
      }
      return { dossier: RACINE, existe: true, fichiers };
    });
    const controles = {
      controles: [{ id: "sante", site: "denivio.fr", titre: "Santé de la prod", cron: "45 7 * * *", type: "script" }],
      modeles: [],
      derniers: {},
      resultats: {},
      enCours: {},
      erreurRegistre: null,
      lancer: vi.fn(),
    };
    render(<Agents sites={SITES} rafraichissement={0} controles={controles} />);
    fireEvent.click(await screen.findByRole("button", { name: /Denivio/ }));

    // Une tache du registre se retire dans les reglages, pas ici
    fireEvent.click(screen.getByRole("button", { name: /Santé de la prod/, expanded: false }));
    expect(screen.queryByRole("button", { name: /Effacer l'historique/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Indexation Google/, expanded: false }));
    fireEvent.click(screen.getByRole("button", { name: /Effacer l'historique/ }));
    expect(invoke).not.toHaveBeenCalledWith("supprimer_rapports_agent", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Effacer" }));

    expect(await screen.findByText("Tout va bien")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("supprimer_rapports_agent", { agent: "indexation" });
    expect(screen.queryByText("Indexation Google")).toBeNull();
  });

  it("les reglages des taches sont replies en bas", async () => {
    invoke.mockResolvedValue({ dossier: RACINE, existe: true, fichiers: FICHIERS });
    const controles = { controles: [], modeles: [], derniers: {}, resultats: {}, enCours: {}, erreurRegistre: null };
    render(<Agents sites={SITES} rafraichissement={0} controles={controles} />);
    const bouton = await screen.findByRole("button", { name: /Réglages des tâches/ });
    expect(screen.queryByText("Tâches planifiées")).toBeNull();
    fireEvent.click(bouton);
    expect(screen.getByText("Tâches planifiées")).toBeTruthy();
  });

  it("demande les rapports depuis la date de debut d'historique", async () => {
    invoke.mockResolvedValue({ dossier: RACINE, existe: false, fichiers: [] });
    render(<Agents sites={SITES} rafraichissement={0} />);
    expect(await screen.findByText("Aucun agent n'a encore déposé de rapport.")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("lire_rapports_agents", { depuis: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it("previent quand les horaires des taches sont introuvables", async () => {
    invoke.mockResolvedValue({ dossier: RACINE, existe: true, fichiers: [] });
    render(<Agents sites={SITES} rafraichissement={0} configTrouvee={false} />);
    expect(await screen.findByText(/Horaires des tâches planifiées introuvables/)).toBeTruthy();
  });

  it("montre l'erreur de lecture au lieu d'une page vide", async () => {
    invoke.mockRejectedValue("acces refuse");
    render(<Agents sites={SITES} rafraichissement={0} />);
    expect(await screen.findByText(/acces refuse/)).toBeTruthy();
  });
});
