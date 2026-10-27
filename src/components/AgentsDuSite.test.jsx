import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { dateDepuis, lireRapport } from "../lib/rapportsAgents";
import { vueParSite } from "../lib/vueAgents";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args) => invoke(...args) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn(() => Promise.resolve()) }));
const writeText = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: (...args) => writeText(...args) }));

const { default: AgentsDuSite } = await import("./AgentsDuSite");

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

/** La vue d'un site, comme App la calcule et la passe a la fiche du site. */
function vue(nom, { fichiers = FICHIERS, attendus = [], controles = null } = {}) {
  const vues = vueParSite({
    rapports: fichiers.map(lireRapport),
    attendus,
    controles: controles?.controles ?? [],
    sites: SITES,
    enCours: Object.values(controles?.enCours ?? {}).filter(Boolean),
  });
  return vues.find((v) => v.nom === nom) ?? null;
}

describe("agents dans la fiche du site", () => {
  it("ce qu'il y a a faire, puis ses taches ; un clic sur une tache : ses rapports", () => {
    render(<AgentsDuSite vue={vue("Denivio")} />);

    const aFaire = screen.getByText("À faire").parentElement;
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
  });

  it("chaque passage dit, logo Claude a l'appui, s'il a fait appel a Claude et pourquoi", () => {
    const fichiers = [
      fichier("denivio.fr", AUJOURDHUI, "sante", { titre: "Santé de la prod", statut: "ok", resume: "RAS", source: "script", claude: "non" }),
      fichier("denivio.fr", HIER, "sante", { titre: "Santé de la prod", statut: "attention", resume: "404", source: "script+claude", claude: "appele" }),
    ];
    render(<AgentsDuSite vue={vue("Denivio", { fichiers })} />);
    fireEvent.click(screen.getByRole("button", { name: /Santé de la prod/, expanded: false }));
    expect(screen.getByRole("img", { name: /Script seul.*Claude n'a pas été appelé/ })).toBeTruthy();
    expect(screen.getByRole("img", { name: /anomalie nouvelle : Claude a été appelé/ })).toBeTruthy();
    // La frise le dit aussi au survol
    expect(screen.getAllByTitle(/sans Claude$/).length).toBe(1);
    expect(screen.getAllByTitle(/Claude utilisé$/).length).toBe(1);
  });

  it("tout va bien : le resume a la place de la liste a faire", () => {
    render(<AgentsDuSite vue={vue("Rois & Empereurs")} />);
    expect(screen.queryByText("À faire")).toBeNull();
    expect(screen.getByText(/La tâche du jour est OK/)).toBeTruthy();
  });

  it("une tache bloquee sans rapport est une action, avec son message", () => {
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
    const v = vue("Denivio", { fichiers: [], attendus });
    expect(v.statut).toBe("action");
    render(<AgentsDuSite vue={v} />);
    expect(screen.getByText("Lancé à 09:04, toujours sans rapport après 1 h")).toBeTruthy();
    expect(screen.getByText("Bloquée ?")).toBeTruthy();
  });

  it("une tache lancee depuis l'appli se montre en cours, avec un carre bleu de plus", () => {
    const controles = {
      controles: [{ id: "sante", site: "denivio.fr", titre: "Santé de la prod", cron: "45 7 * * *", type: "script" }],
      enCours: { script: "sante", claude: null },
      lancer: vi.fn(),
    };
    render(<AgentsDuSite vue={vue("Denivio", { controles })} controles={controles} />);
    const ligne = screen.getByRole("button", { name: /Santé de la prod/, expanded: false });
    expect(ligne.textContent).toContain("En cours");
    expect(within(ligne).getByTitle("En cours").style.background).toBe("rgb(56, 189, 248)");
  });

  it("une tache hors du registre peut perdre son historique, apres confirmation", async () => {
    invoke.mockResolvedValue(2);
    const onEfface = vi.fn();
    const controles = {
      controles: [{ id: "sante", site: "denivio.fr", titre: "Santé de la prod", cron: "45 7 * * *", type: "script" }],
      enCours: {},
      lancer: vi.fn(),
    };
    render(<AgentsDuSite vue={vue("Denivio", { controles })} controles={controles} onEfface={onEfface} />);

    // Une tache du registre se retire dans l'onglet Agents, pas ici
    fireEvent.click(screen.getByRole("button", { name: /Santé de la prod/, expanded: false }));
    expect(screen.queryByRole("button", { name: /Effacer l'historique/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Indexation Google/, expanded: false }));
    fireEvent.click(screen.getByRole("button", { name: /Effacer l'historique/ }));
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Effacer" }));

    await vi.waitFor(() => expect(onEfface).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith("supprimer_rapports_agent", { agent: "indexation" });
  });

  it("sans tache : renvoie vers l'onglet Agents", () => {
    render(<AgentsDuSite vue={null} />);
    expect(screen.getByText(/ajoute-en une dans l'onglet Agents/)).toBeTruthy();
  });
});
