// @vitest-environment node
// Ces tests parlent a SQLite, pas au DOM: l'environnement jsdom refuserait
// d'importer le module natif node:sqlite.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests des requetes SQL reelles, jouees sur une base SQLite en memoire.
 *
 * On ne teste pas des chaines SQL a la main: le module `./db` est remplace par
 * un adaptateur vers node:sqlite, et ce sont les VRAIES fonctions de queries.js
 * qui s'executent, sur le schema produit par les VRAIES migrations. Une erreur
 * de jointure ou une colonne renommee casse donc ces tests.
 */
const etat = vi.hoisted(() => ({ base: null }));

/**
 * SQLite accepte `?` positionnel; nos requetes utilisent `$1`, `$2`...
 * On convertit en respectant l'ordre d'apparition, ce qui gere aussi un
 * parametre reutilise ou des numeros hors sequence.
 */
function convertir(sql, params) {
  const ordre = [];
  const sqlConverti = sql.replace(/\$(\d+)/g, (_, n) => {
    ordre.push(Number(n) - 1);
    return "?";
  });
  const valeurs = ordre.map((i) => {
    const v = params[i];
    if (v === undefined || v === null) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    return v;
  });
  return { sqlConverti, valeurs };
}

vi.mock("./db", () => ({
  select: async (sql, params = []) => {
    const { sqlConverti, valeurs } = convertir(sql, params);
    return etat.base.prepare(sqlConverti).all(...valeurs);
  },
  execute: async (sql, params = []) => {
    const { sqlConverti, valeurs } = convertir(sql, params);
    const res = etat.base.prepare(sqlConverti).run(...valeurs);
    return {
      rowsAffected: Number(res.changes),
      lastInsertId: Number(res.lastInsertRowid),
    };
  },
}));

const {
  arreterAbonnement,
  reprendreAbonnement,
  lirePreference,
  ecrirePreference,
  majAbonnement,
  majTarif,
  supprimerTarif,
  partsAbonnement,
  ajouterTarif,
  listerAbonnements,
  listerTarifs,
  ajouterAbonnement,
  ajouterDepense,
  ajouterRevenu,
  checksActifs,
  creerCheck,
  creerSite,
  depensesParSite,
  echeancesProches,
  enregistrerVerification,
  etatsDesSites,
  listerChecks,
  listerDepenses,
  listerRevenus,
  purgerVerifications,
  supprimerSite,
} = await import("./queries");

const DOSSIER_MIGRATIONS = path.resolve(__dirname, "../../src-tauri/migrations");
// Lu depuis le disque plutot qu'ecrit en dur: une migration ajoutee a l'appli
// et oubliee ici ferait echouer les tests pour une mauvaise raison.
const MIGRATIONS = readdirSync(DOSSIER_MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort();

beforeEach(() => {
  etat.base = new DatabaseSync(":memory:");
  // sqlx active les cles etrangeres par defaut sur SQLite: on reproduit la
  // meme configuration, sinon les suppressions en cascade ne seraient pas testees.
  etat.base.exec("PRAGMA foreign_keys = ON");
  for (const fichier of MIGRATIONS) {
    etat.base.exec(readFileSync(path.join(DOSSIER_MIGRATIONS, fichier), "utf8"));
  }
});

async function creerDeuxSites() {
  await creerSite({ nom: "Denivio", url: "https://denivio.fr" });
  await creerSite({ nom: "HistorySite", url: "https://histoire.fr" });
  const lignes = etat.base.prepare("SELECT id FROM sites ORDER BY nom").all();
  return lignes.map((l) => l.id);
}

describe("migrations", () => {
  it("sont toutes jouees, sans liste ecrite en dur", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(6);
    expect(MIGRATIONS[0]).toBe("001_init.sql");
  });

  it("produisent le schema attendu", () => {
    const tables = etat.base
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((t) => t.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "sites",
        "depenses",
        "depense_sites",
        "revenus",
        "revenu_sites",
        "abonnements",
        "abonnement_sites",
        "checks",
        "verifications",
      ]),
    );
  });

  it("ont supprime les colonnes site_id devenues concurrentes", () => {
    for (const table of ["depenses", "revenus", "abonnements"]) {
      const colonnes = etat.base.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      expect(colonnes).not.toContain("site_id");
    }
  });
});

describe("creerSite", () => {
  it("cree un check d'accueil quand le site a une URL", async () => {
    await creerSite({ nom: "Denivio", url: "https://denivio.fr" });
    const checks = etat.base.prepare("SELECT * FROM checks").all();
    expect(checks).toHaveLength(1);
    expect(checks[0].url).toBe("https://denivio.fr");
    expect(checks[0].type).toBe("http");
  });

  it("ne cree aucun check sans URL", async () => {
    await creerSite({ nom: "SansUrl", url: "" });
    expect(etat.base.prepare("SELECT COUNT(*) AS n FROM checks").get().n).toBe(0);
  });
});

describe("depenses partagees", () => {
  it("repartit a parts egales et conserve le total", async () => {
    const [denivio, histoire] = await creerDeuxSites();
    await ajouterDepense({
      siteIds: [denivio, histoire],
      date: "2026-09-11",
      montantCents: 1100,
      libelle: "Ionos",
    });

    const parts = etat.base.prepare("SELECT part_cents FROM depense_sites ORDER BY site_id").all();
    expect(parts.map((p) => p.part_cents)).toEqual([550, 550]);
  });

  it("accepte des parts inegales dont la somme fait le montant", async () => {
    const [denivio, histoire] = await creerDeuxSites();
    await ajouterDepense({
      siteIds: [denivio, histoire],
      partsCents: [880, 220],
      date: "2026-09-11",
      montantCents: 1100,
      libelle: "Ionos 80/20",
    });

    const somme = etat.base.prepare("SELECT SUM(part_cents) AS t FROM depense_sites").get().t;
    expect(somme).toBe(1100);
  });

  it("refuse des parts dont la somme ne fait pas le montant", async () => {
    const [denivio, histoire] = await creerDeuxSites();
    await expect(
      ajouterDepense({
        siteIds: [denivio, histoire],
        partsCents: [800, 200],
        date: "2026-09-11",
        montantCents: 1100,
        libelle: "incoherent",
      }),
    ).rejects.toThrow(/somme des parts/);
  });

  it("n'ecrit aucune depense orpheline quand les parts sont refusees", async () => {
    const [denivio, histoire] = await creerDeuxSites();
    await expect(
      ajouterDepense({
        siteIds: [denivio, histoire],
        partsCents: [1, 2],
        date: "2026-09-11",
        montantCents: 1100,
        libelle: "incoherent",
      }),
    ).rejects.toThrow();

    // La validation doit avoir lieu avant l'INSERT, pas apres
    expect(etat.base.prepare("SELECT COUNT(*) AS n FROM depenses").get().n).toBe(0);
  });

  it("somme les parts et non les montants dans la repartition par site", async () => {
    const [denivio, histoire] = await creerDeuxSites();
    await ajouterDepense({
      siteIds: [denivio, histoire],
      date: "2026-09-11",
      montantCents: 1100,
      libelle: "Ionos",
    });

    const parSite = await depensesParSite("2026-09-01", "2026-09-30");
    const total = parSite.reduce((t, s) => t + s.total_cents, 0);
    expect(total).toBe(1100);
    expect(parSite.every((s) => s.total_cents === 550)).toBe(true);
  });

  it("ignore les depenses hors de la periode demandee", async () => {
    const [denivio] = await creerDeuxSites();
    await ajouterDepense({
      siteIds: [denivio],
      date: "2026-08-15",
      montantCents: 5000,
      libelle: "aout",
    });

    const parSite = await depensesParSite("2026-09-01", "2026-09-30");
    expect(parSite.reduce((t, s) => t + s.total_cents, 0)).toBe(0);
  });

  it("renvoie la part du site quand on filtre par site", async () => {
    const [denivio, histoire] = await creerDeuxSites();
    await ajouterDepense({
      siteIds: [denivio, histoire],
      date: "2026-09-11",
      montantCents: 1100,
      libelle: "Ionos",
    });

    const [ligne] = await listerDepenses({ siteId: denivio });
    expect(ligne.montant_cents).toBe(1100);
    expect(ligne.part_cents).toBe(550);
    expect(ligne.nb_sites).toBe(2);
    expect(ligne.sites_noms).toContain("Denivio");
  });

  it("supprime les rattachements quand le site disparait", async () => {
    const [denivio, histoire] = await creerDeuxSites();
    await ajouterDepense({
      siteIds: [denivio, histoire],
      date: "2026-09-11",
      montantCents: 1100,
      libelle: "Ionos",
    });

    await supprimerSite(denivio);
    const restants = etat.base.prepare("SELECT site_id FROM depense_sites").all();
    expect(restants).toEqual([{ site_id: histoire }]);
  });
});

describe("revenus partages", () => {
  it("se rattachent a plusieurs sites comme les depenses", async () => {
    const [denivio, histoire] = await creerDeuxSites();
    await ajouterRevenu({
      siteIds: [denivio, histoire],
      date: "2026-09-11",
      montantCents: 4990,
      libelle: "Soutiens",
    });

    const [ligne] = await listerRevenus({});
    expect(ligne.nb_sites).toBe(2);
    expect(etat.base.prepare("SELECT SUM(part_cents) AS t FROM revenu_sites").get().t).toBe(4990);
  });
});

describe("abonnements", () => {
  it("remontent dans les echeances proches", async () => {
    const [denivio] = await creerDeuxSites();
    const dans10Jours = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await ajouterAbonnement({
      siteIds: [denivio],
      libelle: "Nom de domaine",
      montantCents: 1500,
      periodicite: "annuel",
      debut: "2024-03-01",
      prochaineEcheance: dans10Jours,
    });

    const echeances = await echeancesProches(45);
    expect(echeances).toHaveLength(1);
    expect(echeances[0].libelle).toBe("Nom de domaine");
    expect(echeances[0].sites_noms).toBe("Denivio");
  });

  it("ignore une echeance au-dela de la fenetre", async () => {
    const [denivio] = await creerDeuxSites();
    const dans90Jours = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    await ajouterAbonnement({
      siteIds: [denivio],
      libelle: "Loin",
      montantCents: 1500,
      debut: "2026-01-01",
      prochaineEcheance: dans90Jours,
    });

    expect(await echeancesProches(45)).toHaveLength(0);
  });
});

describe("supervision", () => {
  it("agrege l'etat d'un site sur le dernier resultat de chaque check", async () => {
    const [denivio] = await creerDeuxSites();
    const [accueil] = await checksActifs();
    const second = await creerCheck({ siteId: denivio, libelle: "API", url: "https://denivio.fr/api" });

    await enregistrerVerification(accueil.id, { ok: true, statut: 200, latence_ms: 40 });
    await enregistrerVerification(second.lastInsertId, {
      ok: false,
      statut: 500,
      latence_ms: 12,
      erreur: "statut HTTP 500",
    });

    const etats = await etatsDesSites();
    const denivioEtat = etats.find((e) => e.id === denivio);
    expect(denivioEtat.nb_checks).toBe(2);
    expect(denivioEtat.nb_resultats).toBe(2);
    expect(denivioEtat.nb_ok).toBe(1);
  });

  it("ne retient que la verification la plus recente d'un check", async () => {
    await creerDeuxSites();
    const [accueil] = await checksActifs();

    await enregistrerVerification(accueil.id, { ok: false, statut: 500, latence_ms: 10 });
    await enregistrerVerification(accueil.id, { ok: true, statut: 200, latence_ms: 10 });

    const [check] = await listerChecks(accueil.id === 1 ? 1 : accueil.id);
    expect(check.dernier_ok).toBe(1);
  });

  it("enregistre les jours restants d'un check TLS", async () => {
    const [denivio] = await creerDeuxSites();
    const cert = await creerCheck({
      siteId: denivio,
      libelle: "Certificat TLS",
      url: "https://denivio.fr",
      type: "tls",
      seuilJours: 21,
    });

    await enregistrerVerification(cert.lastInsertId, {
      ok: true,
      statut: null,
      latence_ms: null,
      jours_restants: 68,
    });

    const checks = await listerChecks(denivio);
    const ligne = checks.find((c) => c.type === "tls");
    expect(ligne.derniers_jours).toBe(68);
    expect(ligne.seuil_jours).toBe(21);
  });

  it("expose le type et le seuil aux cycles de supervision", async () => {
    const [denivio] = await creerDeuxSites();
    await creerCheck({
      siteId: denivio,
      libelle: "Certificat TLS",
      url: "https://denivio.fr",
      type: "tls",
      seuilJours: 30,
    });

    const actifs = await checksActifs();
    const tls = actifs.find((c) => c.type === "tls");
    expect(tls.seuil_jours).toBe(30);
  });

  it("purge les verifications au-dela du delai de retention", async () => {
    await creerDeuxSites();
    const [accueil] = await checksActifs();
    await enregistrerVerification(accueil.id, { ok: true, statut: 200, latence_ms: 10 });

    // Une verification vieille de 60 jours, injectee directement
    etat.base
      .prepare(
        `INSERT INTO verifications (check_id, verifie_le, ok, statut_http)
         VALUES (?, datetime('now', 'localtime', '-60 days'), 1, 200)`,
      )
      .run(accueil.id);

    expect(etat.base.prepare("SELECT COUNT(*) AS n FROM verifications").get().n).toBe(2);
    await purgerVerifications(30);
    expect(etat.base.prepare("SELECT COUNT(*) AS n FROM verifications").get().n).toBe(1);
  });
});

describe("tarifs d'abonnement", () => {
  async function abonnementAvecTarif(montantCents, siteIds, partsCents = null) {
    await ajouterAbonnement({
      siteIds,
      partsCents,
      libelle: "Nom de domaine",
      montantCents,
      periodicite: "annuel",
      debut: "2024-03-01",
    });
    const [abo] = await listerAbonnements();
    return abo;
  }

  it("cree un tarif initial a la creation de l'abonnement", async () => {
    const [denivio] = await creerDeuxSites();
    await abonnementAvecTarif(600, [denivio]);

    const tarifs = await listerTarifs();
    expect(tarifs).toHaveLength(1);
    expect(tarifs[0].montant_cents).toBe(600);
    expect(tarifs[0].debut).toBe("2024-03-01");
  });

  it("expose le tarif en vigueur, pas le premier ni un tarif futur", async () => {
    const [denivio] = await creerDeuxSites();
    const abo = await abonnementAvecTarif(600, [denivio]);

    await ajouterTarif(abo.id, { debut: "2025-03-01", montantCents: 1100 });
    await ajouterTarif(abo.id, { debut: "2099-01-01", montantCents: 9900 });

    const [relu] = await listerAbonnements();
    expect(relu.montant_cents).toBe(1100);
  });

  it("redistribue les parts quand le tarif change", async () => {
    const [denivio, histoire] = await creerDeuxSites();
    const abo = await abonnementAvecTarif(600, [denivio, histoire]);

    await ajouterTarif(abo.id, { debut: "2025-03-01", montantCents: 1100 });

    const parts = etat.base
      .prepare("SELECT part_cents FROM abonnement_sites WHERE abonnement_id = ? ORDER BY site_id")
      .all(abo.id)
      .map((p) => p.part_cents);

    // L'invariant "somme des parts = montant courant" doit tenir apres la hausse
    expect(parts.reduce((t, p) => t + p, 0)).toBe(1100);
    expect(parts).toEqual([550, 550]);
  });

  it("conserve les proportions d'un partage inegal lors d'une hausse", async () => {
    const [denivio, histoire] = await creerDeuxSites();
    const abo = await abonnementAvecTarif(1000, [denivio, histoire], [800, 200]);

    await ajouterTarif(abo.id, { debut: "2025-03-01", montantCents: 2000 });

    const parts = etat.base
      .prepare("SELECT site_id, part_cents FROM abonnement_sites WHERE abonnement_id = ?")
      .all(abo.id);
    const parSite = Object.fromEntries(parts.map((p) => [p.site_id, p.part_cents]));

    expect(parSite[denivio]).toBe(1600);
    expect(parSite[histoire]).toBe(400);
  });

  it("supprime les tarifs avec l'abonnement", async () => {
    const [denivio] = await creerDeuxSites();
    const abo = await abonnementAvecTarif(600, [denivio]);
    await ajouterTarif(abo.id, { debut: "2025-03-01", montantCents: 1100 });

    etat.base.prepare("DELETE FROM abonnements WHERE id = ?").run(abo.id);
    expect(await listerTarifs()).toHaveLength(0);
  });
});

describe("edition d'un abonnement", () => {
  async function creerVps(siteIds, montantCents = 1080) {
    await ajouterAbonnement({
      siteIds,
      libelle: "VPS",
      montantCents,
      periodicite: "mensuel",
      debut: "2026-09-11",
    });
    const [abo] = await listerAbonnements();
    return abo;
  }

  it("corrige une date de depart saisie de travers", async () => {
    const [denivio] = await creerDeuxSites();
    const abo = await creerVps([denivio]);

    await majAbonnement(abo.id, {
      fournisseurId: null,
      libelle: "VPS",
      periodicite: "mensuel",
      debut: "2025-01-15",
      prochaineEcheance: null,
      siteIds: [denivio],
    });

    const [relu] = await listerAbonnements();
    expect(relu.debut).toBe("2025-01-15");
  });

  it("remplace les sites rattaches sans laisser de part orpheline", async () => {
    const [denivio, histoire] = await creerDeuxSites();
    const abo = await creerVps([denivio, histoire]);

    // On retire HistorySite: Denivio doit porter la totalite
    await majAbonnement(abo.id, {
      fournisseurId: null,
      libelle: "VPS",
      periodicite: "mensuel",
      debut: "2026-09-11",
      prochaineEcheance: null,
      siteIds: [denivio],
    });

    const parts = await partsAbonnement(abo.id);
    expect(parts).toHaveLength(1);
    expect(parts[0].site_id).toBe(denivio);
    expect(parts[0].part_cents).toBe(1080);
  });

  it("refuse une repartition incoherente sans rien modifier", async () => {
    const [denivio, histoire] = await creerDeuxSites();
    const abo = await creerVps([denivio, histoire]);

    await expect(
      majAbonnement(abo.id, {
        fournisseurId: null,
        libelle: "Renomme",
        periodicite: "mensuel",
        debut: "2026-09-11",
        prochaineEcheance: null,
        siteIds: [denivio, histoire],
        partsCents: [100, 200],
      }),
    ).rejects.toThrow(/somme des parts/);

    const [relu] = await listerAbonnements();
    expect(relu.libelle).toBe("VPS");
  });

  it("recalcule les parts quand on corrige un tarif", async () => {
    const [denivio, histoire] = await creerDeuxSites();
    const abo = await creerVps([denivio, histoire]);
    const [tarif] = await listerTarifs();

    await majTarif(tarif.id, { debut: "2026-09-11", montantCents: 2000 });

    const parts = await partsAbonnement(abo.id);
    expect(parts.reduce((t, p) => t + p.part_cents, 0)).toBe(2000);
  });

  it("revient au tarif precedent quand on supprime le plus recent", async () => {
    const [denivio, histoire] = await creerDeuxSites();
    const abo = await creerVps([denivio, histoire], 1000);
    await ajouterTarif(abo.id, { debut: "2026-09-12", montantCents: 3000 });

    const recent = (await listerTarifs()).find((t) => t.montant_cents === 3000);
    await supprimerTarif(recent.id);

    const [relu] = await listerAbonnements();
    expect(relu.montant_cents).toBe(1000);

    // Les parts doivent suivre le retour au prix precedent
    const parts = await partsAbonnement(abo.id);
    expect(parts.reduce((t, p) => t + p.part_cents, 0)).toBe(1000);
  });
});

describe("site disparu", () => {
  // Cas rencontre: les sites avaient ete supprimes, le formulaire gardait leurs
  // identifiants, et l'insertion echouait sur "code 787 FOREIGN KEY constraint
  // failed" - un message qui ne dit pas quoi corriger.
  it("refuse une depense visant un site inexistant, avec un message clair", async () => {
    await expect(
      ajouterDepense({
        siteIds: [4242],
        date: "2026-09-11",
        montantCents: 1100,
        libelle: "Ionos",
      }),
    ).rejects.toThrow(/n'existe encore/);
  });

  it("n'ecrit aucune depense orpheline dans ce cas", async () => {
    await expect(
      ajouterDepense({
        siteIds: [4242],
        date: "2026-09-11",
        montantCents: 1100,
        libelle: "Ionos",
      }),
    ).rejects.toThrow();

    // L'INSERT parent ne doit pas avoir eu lieu: ces ecritures ne sont pas
    // transactionnelles, la validation doit donc preceder toute ecriture.
    expect(etat.base.prepare("SELECT COUNT(*) AS n FROM depenses").get().n).toBe(0);
  });

  it("signale une selection partiellement obsolete", async () => {
    const [denivio] = await creerDeuxSites();
    await expect(
      ajouterDepense({
        siteIds: [denivio, 4242],
        date: "2026-09-11",
        montantCents: 1100,
        libelle: "Ionos",
      }),
    ).rejects.toThrow(/n'existent plus/);
  });

  it("protege aussi les revenus et les abonnements", async () => {
    await expect(
      ajouterRevenu({ siteIds: [4242], date: "2026-09-11", montantCents: 500 }),
    ).rejects.toThrow(/n'existe encore/);

    await expect(
      ajouterAbonnement({
        siteIds: [4242],
        libelle: "VPS",
        montantCents: 500,
        debut: "2026-09-11",
      }),
    ).rejects.toThrow(/n'existe encore/);

    expect(etat.base.prepare("SELECT COUNT(*) AS n FROM revenus").get().n).toBe(0);
    expect(etat.base.prepare("SELECT COUNT(*) AS n FROM abonnements").get().n).toBe(0);
  });

  it("laisse passer une depense transverse, sans aucun site", async () => {
    // Zero site est un cas legitime (cout transverse), a ne pas confondre avec
    // un site disparu.
    await ajouterAbonnement({
      siteIds: [],
      libelle: "Transverse",
      montantCents: 500,
      debut: "2026-09-11",
    });
    expect(etat.base.prepare("SELECT COUNT(*) AS n FROM abonnements").get().n).toBe(1);
  });
});

describe("preferences", () => {
  it("relit ce qui a ete ecrit", async () => {
    await ecrirePreference("tableau_periode", "12mois");
    expect(await lirePreference("tableau_periode", "annee")).toBe("12mois");
  });

  it("remplace une valeur existante au lieu d'en empiler une seconde", async () => {
    await ecrirePreference("tableau_periode", "mois");
    await ecrirePreference("tableau_periode", "toujours");

    expect(await lirePreference("tableau_periode")).toBe("toujours");
    const n = etat.base
      .prepare("SELECT COUNT(*) AS n FROM preferences WHERE cle = 'tableau_periode'")
      .get().n;
    expect(n).toBe(1);
  });

  it("renvoie le defaut pour une cle jamais ecrite", async () => {
    expect(await lirePreference("cle_inexistante", "secours")).toBe("secours");
    expect(await lirePreference("cle_inexistante")).toBeNull();
  });

  it("conserve la chaine vide, qui represente tous les sites", async () => {
    // Elle ne doit pas etre confondue avec une absence de preference
    await ecrirePreference("tableau_site", "3");
    await ecrirePreference("tableau_site", "");
    expect(await lirePreference("tableau_site", "3")).toBe("");
  });

  it("garde l'intervalle de supervision installe par la migration", async () => {
    expect(await lirePreference("intervalle_supervision_s")).toBe("60");
  });
});

describe("arreter et reprendre un abonnement", () => {
  async function creerVps(siteIds = []) {
    await ajouterAbonnement({
      siteIds,
      libelle: "VPS",
      montantCents: 1080,
      periodicite: "mensuel",
      debut: "2025-01-01",
    });
    const [abo] = await listerAbonnements();
    return abo;
  }

  it("enregistre la date d'arret et desactive d'un seul geste", async () => {
    const abo = await creerVps();
    await arreterAbonnement(abo.id, "2026-03-01");

    const [relu] = await listerAbonnements();
    expect(relu.fin).toBe("2026-03-01");
    expect(relu.actif).toBe(0);
  });

  it("ne laisse jamais fin et actif diverger", async () => {
    // C'est la divergence qui trompait: case decochee et montants qui montent
    const abo = await creerVps();
    await arreterAbonnement(abo.id, "2026-03-01");
    let [relu] = await listerAbonnements();
    expect(Boolean(relu.fin)).toBe(relu.actif === 0);

    await reprendreAbonnement(abo.id);
    [relu] = await listerAbonnements();
    expect(relu.fin).toBeNull();
    expect(relu.actif).toBe(1);
  });

  it("conserve l'abonnement, ses tarifs et ses parts apres l'arret", async () => {
    const [denivio] = await creerDeuxSites();
    const abo = await creerVps([denivio]);
    await arreterAbonnement(abo.id, "2026-03-01");

    // Arreter n'est pas supprimer: le passe reste consultable
    expect(await listerTarifs()).toHaveLength(1);
    expect(await partsAbonnement(abo.id)).toHaveLength(1);
  });

  it("corrige la date d'arret par l'edition, et la remet a zero si on la vide", async () => {
    const abo = await creerVps();
    await arreterAbonnement(abo.id, "2026-03-01");

    await majAbonnement(abo.id, {
      fournisseurId: null,
      libelle: "VPS",
      periodicite: "mensuel",
      debut: "2025-01-01",
      fin: "2026-05-01",
      prochaineEcheance: null,
      siteIds: [],
    });
    let [relu] = await listerAbonnements();
    expect(relu.fin).toBe("2026-05-01");
    expect(relu.actif).toBe(0);

    await majAbonnement(abo.id, {
      fournisseurId: null,
      libelle: "VPS",
      periodicite: "mensuel",
      debut: "2025-01-01",
      fin: null,
      prochaineEcheance: null,
      siteIds: [],
    });
    [relu] = await listerAbonnements();
    expect(relu.fin).toBeNull();
    expect(relu.actif).toBe(1);
  });

  it("sort des echeances a venir une fois arrete", async () => {
    const abo = await creerVps();
    const dans10Jours = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await majAbonnement(abo.id, {
      fournisseurId: null,
      libelle: "VPS",
      periodicite: "mensuel",
      debut: "2025-01-01",
      prochaineEcheance: dans10Jours,
      siteIds: [],
    });
    expect(await echeancesProches(45)).toHaveLength(1);

    await arreterAbonnement(abo.id, "2026-03-01");
    expect(await echeancesProches(45)).toHaveLength(0);
  });
});
