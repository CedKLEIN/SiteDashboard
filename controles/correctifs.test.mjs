// @vitest-environment node
import { describe, expect, it } from "vitest";
import { consigneReparation, corriger, nomBranche } from "./correctifs.mjs";
import { grave, signatureCorrectifs, vulnerabilites } from "./lib/dependances.mjs";
import { suitesDemandees } from "./lancer.mjs";

const AUDIT = {
  vulnerabilities: {
    vite: { severity: "high", range: "8.2.0 - 8.2.2", fixAvailable: true },
    undici: { severity: "high", range: "7.0.0 - 7.30.0", fixAvailable: { name: "jsdom", version: "26.0.0", isSemVerMajor: false } },
    esbuild: { severity: "moderate", range: "<=0.24.2", fixAvailable: { name: "vite", version: "9.0.0", isSemVerMajor: true } },
    vieux: { severity: "critical", range: "*", fixAvailable: false },
  },
};
const PROPRE = { vulnerabilities: {} };
const VERIFS = ["npm.cmd test", "npm.cmd run lint", "npm.cmd run build"];

/**
 * Un faux depot : `sh` repond aux commandes git et npm selon un petit etat
 * (branche, fichiers modifies, audit), et garde l'historique des commandes.
 */
function fauxDepot({
  git = true,
  enCours = "",
  branche = "main",
  audit = AUDIT,
  apresFix = PROPRE,
  fixChange = true,
  fixEchoue = false,
  echecs = {},
  branches = [],
  commitEchoue = false,
} = {}) {
  const etat = { branche, modifie: enCours, audit, branches: new Set([branche, ...branches]), commits: [], echecs: { ...echecs } };
  const commandes = [];
  const sh = (c) => {
    commandes.push(c);
    const ok = (sortie = "") => ({ code: 0, sortie });
    if (c === "git rev-parse --is-inside-work-tree") return git ? ok("true") : { code: 128, sortie: "fatal: not a git repository" };
    if (c === "git status --porcelain") return ok(etat.modifie);
    if (c === "git branch --show-current") return ok(`${etat.branche}\n`);
    if (c.startsWith("git rev-parse --verify --quiet refs/heads/")) return { code: etat.branches.has(c.split("refs/heads/")[1]) ? 0 : 1, sortie: "" };
    if (c.startsWith("git switch -c ")) {
      etat.branche = c.slice("git switch -c ".length);
      etat.branches.add(etat.branche);
      return ok();
    }
    if (c.startsWith("git switch ")) {
      etat.branche = c.slice("git switch ".length);
      return ok();
    }
    if (c.startsWith("git branch -D ")) {
      etat.branches.delete(c.slice("git branch -D ".length));
      return ok();
    }
    if (c === "git reset --hard" || c === "git clean -fd") {
      etat.modifie = "";
      return ok();
    }
    if (c === "git add -A") return ok();
    if (c.startsWith("git commit")) {
      if (commitEchoue) return { code: 1, sortie: "erreur" };
      etat.commits.push({ branche: etat.branche, message: c });
      etat.modifie = "";
      return ok();
    }
    if (c === "npm.cmd audit --json") return ok(JSON.stringify(etat.audit));
    if (c.startsWith("git rev-list --count ")) {
      const cible = c.split("..")[1];
      return ok(String(etat.commits.filter((x) => x.branche === cible).length));
    }
    if (c === "npm.cmd audit fix --no-fund") {
      if (fixEchoue) return { code: 1, sortie: "npm error Cannot read properties of null (reading 'edgesOut')" };
      if (fixChange) {
        etat.modifie = " M package-lock.json";
        etat.audit = apresFix;
      }
      return ok();
    }
    if (c === "npm.cmd ci --no-audit --no-fund") return ok();
    if (VERIFS.includes(c)) {
      const restants = etat.echecs[c] ?? 0;
      if (restants > 0) {
        etat.echecs[c] = restants - 1;
        return { code: 1, sortie: `FAIL ${c}: TypeError dans src/carte.test.js` };
      }
      return ok("passe");
    }
    throw new Error(`commande inattendue : ${c}`);
  };
  return { sh, etat, commandes };
}

const lancerCorriger = (depot, options = {}) =>
  corriger({ verifications: VERIFS, jour: "2026-10-26", sh: depot.sh, reparer: async () => null, ...options });

describe("vulnerabilites npm", () => {
  it("distingue correctif compatible, version majeure et aucun correctif", () => {
    const v = vulnerabilites(AUDIT);
    expect(v.map((x) => [x.nom, x.correctif])).toEqual([
      ["vite", "compatible"],
      ["undici", "compatible"],
      ["esbuild", "majeur"],
      ["vieux", "aucun"],
    ]);
    expect(v.filter(grave).map((x) => x.nom)).toEqual(["vite", "undici", "vieux"]);
    expect(vulnerabilites(null)).toEqual([]);
  });

  it("signe seulement les hautes ou critiques corrigeables, dans un ordre stable", () => {
    expect(signatureCorrectifs(vulnerabilites(AUDIT))).toBe("undici@7.0.0 - 7.30.0,vite@8.2.0 - 8.2.2");
    expect(signatureCorrectifs(vulnerabilites({ vulnerabilities: { a: { severity: "moderate", fixAvailable: true } } }))).toBe("");
    expect(signatureCorrectifs([])).toBe("");
  });
});

describe("audit -> correctif (suites)", () => {
  const registre = [
    { id: "audit-hebdo-denivio", modele: "audit-hebdo", siteCle: "denivio" },
    { id: "correctifs-denivio", modele: "correctifs", siteCle: "denivio" },
    { id: "correctifs-roisempereurs", modele: "correctifs", siteCle: "roisempereurs" },
    { id: "correctifs-casse", modele: "correctifs", siteCle: "denivio", erreur: "fiche incomplète" },
  ];
  const audit = registre[0];
  const demande = [{ modele: "correctifs", signature: "vite@8" }];

  it("demande le correctif du meme site, pas celui des autres ni un mal configure", () => {
    expect(suitesDemandees(audit, demande, registre, () => ({}))).toEqual(["correctifs-denivio"]);
  });

  it("ne redemande pas ce que le correctif a deja tente", () => {
    expect(suitesDemandees(audit, demande, registre, () => ({ signatureTraitee: "vite@8" }))).toEqual([]);
    // Une nouvelle vulnerabilite change la signature : nouvelle demande
    expect(suitesDemandees(audit, demande, registre, () => ({ signatureTraitee: "undici@7" }))).toEqual(["correctifs-denivio"]);
  });

  it("rien a demander sans suites", () => {
    expect(suitesDemandees(audit, undefined, registre, () => ({}))).toEqual([]);
    expect(suitesDemandees(audit, [], registre, () => ({}))).toEqual([]);
  });
});

describe("correctifs : garde-fous", () => {
  it("ne fait rien hors d'un depot git", async () => {
    const depot = fauxDepot({ git: false });
    const r = await lancerCorriger(depot);
    expect(r.points[0]).toMatchObject({ niveau: "echec", sansAnalyse: true });
    expect(depot.commandes).toEqual(["git rev-parse --is-inside-work-tree"]);
  });

  it("ne touche pas a un depot qui a du travail en cours", async () => {
    const depot = fauxDepot({ enCours: " M src/App.jsx\n?? notes.md" });
    const r = await lancerCorriger(depot);
    expect(r.points[0].niveau).toBe("attention");
    expect(r.points[0].texte).toContain("2 fichier(s)");
    expect(depot.commandes.some((c) => c.includes("audit fix") || c.startsWith("git switch"))).toBe(false);
    // Pas de signature : l'audit suivant redemandera le correctif
    expect(r.signature).toBeNull();
  });

  it("ne fait rien sur un HEAD detache", async () => {
    const depot = fauxDepot({ branche: "" });
    const r = await lancerCorriger(depot);
    expect(r.resume).toContain("aucune branche");
  });

  it("rien a corriger : ok, sans branche", async () => {
    const depot = fauxDepot({ audit: PROPRE });
    const r = await lancerCorriger(depot);
    expect(r.points).toEqual([{ niveau: "ok", texte: "Aucune vulnérabilité", sansAnalyse: true }]);
    expect(depot.commandes.some((c) => c.startsWith("git switch"))).toBe(false);
  });

  it("une version majeure n'est jamais installee : elle est signalee", async () => {
    const depot = fauxDepot({ audit: { vulnerabilities: { esbuild: AUDIT.vulnerabilities.esbuild } } });
    const r = await lancerCorriger(depot);
    expect(r.points[0].texte).toContain("À faire à la main (version majeure) : esbuild (moderate)");
    expect(depot.commandes.some((c) => c.includes("--force"))).toBe(false);
    expect(depot.commandes.some((c) => c.includes("audit fix"))).toBe(false);
  });

  it("en essai, dit ce qui serait corrige sans rien modifier", async () => {
    const depot = fauxDepot();
    const r = await lancerCorriger(depot, { essai: true });
    expect(r.points[0].texte).toContain("Essai : 2 vulnérabilité(s) à corriger (vite, undici)");
    expect(depot.commandes.every((c) => !c.startsWith("git switch") && !c.includes("audit fix"))).toBe(true);
  });
});

describe("correctifs : deroulement", () => {
  it("tout passe : commit sur une branche a part, retour a la branche de depart, rien de pousse", async () => {
    const depot = fauxDepot();
    const reparer = async () => {
      throw new Error("Claude ne doit pas etre appele");
    };
    const r = await lancerCorriger(depot, { reparer });
    expect(depot.etat.commits).toEqual([{ branche: "correctifs/2026-10-26", message: expect.stringContaining("npm audit fix") }]);
    expect(depot.etat.branche).toBe("main");
    expect(depot.etat.branches.has("correctifs/2026-10-26")).toBe(true);
    expect(depot.commandes).toContain("npm.cmd audit fix --no-fund");
    expect(depot.commandes.some((c) => c.includes("push") || c.includes("--force"))).toBe(false);
    // node_modules resynchronise avec le package-lock de la branche de depart
    expect(depot.commandes.at(-1)).toBe("npm.cmd ci --no-audit --no-fund");
    expect(r.points[0]).toMatchObject({ niveau: "attention", sansAnalyse: true });
    expect(r.points[0].texte).toContain("branche `correctifs/2026-10-26` à fusionner");
    expect(r.signature).toBe("undici@7.0.0 - 7.30.0,vite@8.2.0 - 8.2.2");
  });

  it("les verifications passent dans l'ordre de la fiche", async () => {
    const depot = fauxDepot();
    await lancerCorriger(depot);
    expect(depot.commandes.filter((c) => VERIFS.includes(c))).toEqual(VERIFS);
  });

  it("ne reprend pas le nom d'une branche existante", async () => {
    expect(nomBranche("2026-10-26", () => false)).toBe("correctifs/2026-10-26");
    const pris = new Set(["correctifs/2026-10-26", "correctifs/2026-10-26-2"]);
    expect(nomBranche("2026-10-26", (n) => pris.has(n))).toBe("correctifs/2026-10-26-3");
    const depot = fauxDepot({ branches: ["correctifs/2026-10-26"] });
    await lancerCorriger(depot);
    expect(depot.etat.commits[0].branche).toBe("correctifs/2026-10-26-2");
  });

  it("npm audit fix ne change rien et Claude indisponible : branche supprimee, signale", async () => {
    const depot = fauxDepot({ fixChange: false });
    const r = await lancerCorriger(depot);
    expect(r.points[0].texte).toContain("n'a rien changé");
    expect(r.points[0].texte).toContain("Claude indisponible");
    expect(depot.etat.branche).toBe("main");
    expect(depot.etat.branches.has("correctifs/2026-10-26")).toBe(false);
    expect(depot.etat.commits).toEqual([]);
    // Aucune verification lancee pour rien
    expect(depot.commandes.some((c) => VERIFS.includes(c))).toBe(false);
  });

  it("verifications OK mais aucune vulnerabilite disparue : rien n'est garde", async () => {
    const depot = fauxDepot({ apresFix: AUDIT });
    const r = await lancerCorriger(depot);
    expect(r.points[0].texte).toContain("aucune vulnérabilité n'a disparu");
    expect(depot.etat.commits).toEqual([]);
    expect(depot.etat.branches.has("correctifs/2026-10-26")).toBe(false);
  });

  it("des vulnerabilites hautes restent apres le correctif : signale", async () => {
    const depot = fauxDepot({ apresFix: { vulnerabilities: { vieux: AUDIT.vulnerabilities.vieux } } });
    const r = await lancerCorriger(depot);
    expect(r.points.map((p) => p.texte)).toContain("Encore 1 vulnérabilité(s) haute(s) ou critique(s) : vieux");
  });

  it("commit impossible : tout est annule", async () => {
    const depot = fauxDepot({ commitEchoue: true });
    const r = await lancerCorriger(depot);
    expect(r.points[0].niveau).toBe("echec");
    expect(depot.etat.branche).toBe("main");
    expect(depot.etat.branches.has("correctifs/2026-10-26")).toBe(false);
  });
});

describe("correctifs : Claude en renfort", () => {
  it("une verification echoue : Claude recoit l'erreur, SiteDashboard reverifie et commite", async () => {
    const depot = fauxDepot({ echecs: { "npm.cmd run lint": 1 } });
    const appels = [];
    const reparer = async (contexte) => {
      appels.push(contexte);
      depot.etat.modifie = " M package-lock.json\n M src/carte.js";
      return { code: 0, sortie: "J'ai adapté src/carte.js à la nouvelle API de vite." };
    };
    const r = await lancerCorriger(depot, { reparer });
    expect(appels).toHaveLength(1);
    expect(appels[0]).toMatchObject({
      branche: "correctifs/2026-10-26",
      commande: "npm.cmd run lint",
      paquets: ["vite", "undici"],
      verifications: VERIFS,
    });
    expect(appels[0].sortie).toContain("TypeError");
    // Reverification complete apres la session, avant le commit
    expect(depot.commandes.filter((c) => c === "npm.cmd test")).toHaveLength(2);
    expect(depot.etat.commits[0].message).toContain("relais de Claude");
    expect(depot.etat.branche).toBe("main");
    expect(r.points.map((p) => p.texte).join(" ")).toContain("relis le diff");
    expect(r.resume).toContain("avec l'aide de Claude");
  });

  it("Claude n'y arrive pas : tout est annule, le depot revient a son etat de depart", async () => {
    const depot = fauxDepot({ echecs: { "npm.cmd test": 5 } });
    const reparer = async () => ({ code: 0, sortie: "Impossible : l'API a changé en profondeur." });
    const r = await lancerCorriger(depot, { reparer });
    expect(depot.etat.commits).toEqual([]);
    expect(depot.etat.branche).toBe("main");
    expect(depot.etat.modifie).toBe("");
    expect(depot.etat.branches.has("correctifs/2026-10-26")).toBe(false);
    expect(depot.commandes).toEqual(expect.arrayContaining(["git reset --hard", "git clean -fd", "git branch -D correctifs/2026-10-26"]));
    expect(r.points[0].texte).toContain("Correctif annulé : `npm.cmd test` échoue");
    expect(r.points[0].texte).toContain("Claude n'a pas réussi");
    expect(r.resume).toContain("revenu à son état de départ");
  });

  it("Claude indisponible : annule aussi, et le dit", async () => {
    const depot = fauxDepot({ echecs: { "npm.cmd run build": 1 } });
    const r = await lancerCorriger(depot);
    expect(r.points[0].texte).toContain("Claude indisponible");
    expect(depot.etat.commits).toEqual([]);
    expect(depot.etat.branche).toBe("main");
  });

  it("Claude a change de branche ou commite malgre la consigne : on revient sur la branche, sans double commit", async () => {
    const depot = fauxDepot({ echecs: { "npm.cmd test": 1 } });
    const reparer = async () => {
      depot.etat.commits.push({ branche: depot.etat.branche, message: "commit de Claude" });
      depot.etat.modifie = "";
      depot.etat.branche = "main";
      return { code: 0, sortie: "fait" };
    };
    await lancerCorriger(depot, { reparer });
    expect(depot.commandes).toContain("git switch correctifs/2026-10-26");
    expect(depot.etat.commits).toHaveLength(1);
    expect(depot.etat.branche).toBe("main");
  });

  it("npm audit fix plante : Claude recoit l'erreur et applique lui-meme les mises a jour", async () => {
    // Le cas reel de Denivio : bug interne de npm avant toute modification
    const depot = fauxDepot({ fixEchoue: true });
    const appels = [];
    const reparer = async (contexte) => {
      appels.push(contexte);
      depot.etat.modifie = " M package.json\n M package-lock.json";
      depot.etat.audit = PROPRE;
      return { code: 0, sortie: "Mis à jour vite 8.2.3 et ajouté un override pour undici." };
    };
    const r = await lancerCorriger(depot, { reparer });
    expect(appels).toHaveLength(1);
    expect(appels[0]).toMatchObject({ etape: "mise-a-jour", commande: "npm audit fix", branche: "correctifs/2026-10-26" });
    expect(appels[0].sortie).toContain("edgesOut");
    expect(appels[0].vulnerables.map((v) => v.nom)).toEqual(["vite", "undici"]);
    // SiteDashboard verifie lui-meme apres la session
    expect(depot.commandes.filter((c) => VERIFS.includes(c))).toEqual(VERIFS);
    expect(depot.etat.commits).toEqual([{ branche: "correctifs/2026-10-26", message: expect.stringContaining("relais de Claude") }]);
    expect(depot.etat.branche).toBe("main");
    expect(r.resume).toContain("2 paquet(s) corrigé(s) avec l'aide de Claude");
  });

  it("npm audit fix plante et Claude ne change rien : annule", async () => {
    const depot = fauxDepot({ fixEchoue: true });
    const r = await lancerCorriger(depot, { reparer: async () => ({ code: 1, sortie: "Je n'ai pas pu résoudre l'arbre npm." }) });
    expect(r.points[0].texte).toContain("npm audit fix a échoué");
    expect(r.points[0].texte).toContain("Claude n'a pas réussi");
    expect(depot.etat.commits).toEqual([]);
    expect(depot.etat.branche).toBe("main");
    expect(depot.etat.branches.has("correctifs/2026-10-26")).toBe(false);
  });

  it("une seule session Claude par passage : si ses mises a jour cassent les tests, on annule", async () => {
    const depot = fauxDepot({ fixEchoue: true, echecs: { "npm.cmd test": 1 } });
    let sessions = 0;
    const reparer = async () => {
      sessions += 1;
      depot.etat.modifie = " M package-lock.json";
      depot.etat.audit = PROPRE;
      return { code: 0, sortie: "fait" };
    };
    const r = await lancerCorriger(depot, { reparer });
    expect(sessions).toBe(1);
    expect(r.points[0].texte).toContain("Correctif annulé : `npm.cmd test` échoue");
    expect(depot.etat.commits).toEqual([]);
  });

  it("la consigne de mise a jour liste les vulnerabilites et interdit les versions majeures", () => {
    const texte = consigneReparation({
      dossier: "C:\\depot",
      branche: "correctifs/2026-10-26",
      etape: "mise-a-jour",
      paquets: ["vite"],
      vulnerables: [{ nom: "vite", gravite: "high", plage: "8.2.0 - 8.2.2" }],
      commande: "npm audit fix",
      sortie: "npm error edgesOut",
      verifications: VERIFS,
    });
    expect(texte).toContain("- vite (high) : 8.2.0 - 8.2.2");
    expect(texte).toContain("npm error edgesOut");
    expect(texte).toContain("sans passer une dépendance directe à une nouvelle version majeure");
    expect(texte).toContain("overrides");
    expect(texte).toContain("ne commite pas, ne pousse pas");
  });

  it("la consigne donne l'erreur, les verifications et les interdits", () => {
    const texte = consigneReparation({
      dossier: "C:\\depot",
      branche: "correctifs/2026-10-26",
      paquets: ["vite"],
      commande: "npm.cmd test",
      sortie: "FAIL carte.test.js",
      verifications: VERIFS,
    });
    expect(texte).toContain("sur la branche `correctifs/2026-10-26`");
    expect(texte).toContain("FAIL carte.test.js");
    expect(texte).toContain("`npm.cmd test`, `npm.cmd run lint`, `npm.cmd run build`");
    expect(texte).toContain("ne commite pas, ne pousse pas");
    expect(texte).toContain("ne reviens pas aux versions vulnérables");
    expect(texte).toContain("ne désactive aucun test");
  });

  it("une sortie d'erreur tres longue est raccourcie par la fin", () => {
    const texte = consigneReparation({ dossier: "d", branche: "b", paquets: [], commande: "c", sortie: `${"x".repeat(10000)}FIN`, verifications: [] });
    expect(texte).toContain("FIN");
    expect(texte.length).toBeLessThan(6000);
  });
});
