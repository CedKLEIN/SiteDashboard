// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cumulParMois, dateDuMois, definition } from "./definitions";

/** Faux reseau : renvoie les pages dans l'ordre, et garde les requetes recues. */
function reseau(pages) {
  const requetes = [];
  const appel = async (requete) => {
    requetes.push(requete);
    return { statut: 200, json: pages.shift() };
  };
  return { appel, requetes };
}

describe("cumul mensuel des couts d'API", () => {
  it("une depense par mois, datee de la fin du mois ou d'aujourd'hui", () => {
    const lignes = cumulParMois(
      [
        { jour: "2026-09-30", cents: 150.4 },
        { jour: "2026-10-01", cents: 100 },
        { jour: "2026-10-02", cents: 99.6 },
      ],
      { prefixe: "anthropic", libelle: "API Anthropic", devise: "USD", aujourdhui: "2026-10-27" },
    );
    expect(lignes.map((l) => [l.ref, l.date, l.montantCents])).toEqual([
      ["anthropic-2026-09", "2026-09-30", 150],
      ["anthropic-2026-10", "2026-10-27", 200],
    ]);
    expect(dateDuMois("2028-02", "2030-01-01")).toBe("2028-02-29");
  });
});

describe("Anthropic", () => {
  it("lit le rapport de couts page par page (montants en centimes)", async () => {
    const { appel, requetes } = reseau([
      { data: [{ starting_at: "2026-10-01T00:00:00Z", results: [{ amount: "1234.5", currency: "USD" }, { amount: "100", currency: "USD" }] }], has_more: true, next_page: "p2" },
      { data: [{ starting_at: "2026-10-02T00:00:00Z", results: [{ amount: "65.5", currency: "USD" }] }], has_more: false },
    ]);
    const lignes = await definition("anthropic").synchroniser({ secret: { cle: "sk-ant-admin-x" }, depuis: "2026-10-01", appel, aujourdhui: "2026-10-27" });
    expect(lignes).toMatchObject([{ sens: "depense", ref: "anthropic-2026-10", montantCents: 1400, devise: "USD", fournisseur: "Anthropic" }]);
    expect(requetes[0].url).toContain("/v1/organizations/cost_report?");
    expect(requetes[0].entetes).toContainEqual(["x-api-key", "sk-ant-admin-x"]);
    expect(requetes[1].url).toContain("page=p2");
  });

  it("dit clairement qu'une cle est refusee", async () => {
    const appel = async () => ({ statut: 401, json: { error: { message: "invalid x-api-key" } } });
    await expect(definition("anthropic").synchroniser({ secret: { cle: "x" }, depuis: "2026-10-01", appel, aujourdhui: "2026-10-27" })).rejects.toThrow(/refuse la clé/);
  });
});

describe("OpenAI", () => {
  it("convertit les dollars en centimes", async () => {
    const debut = Date.UTC(2026, 9, 3) / 1000;
    const { appel } = reseau([{ data: [{ start_time: debut, results: [{ amount: { value: 1.234, currency: "usd" } }] }], has_more: false }]);
    const [ligne] = await definition("openai").synchroniser({ secret: { cle: "k" }, depuis: "2026-10-01", appel, aujourdhui: "2026-10-27" });
    expect(ligne).toMatchObject({ ref: "openai-2026-10", montantCents: 123, devise: "USD" });
  });
});

describe("Stripe", () => {
  it("paiements et remboursements en revenus, frais cumules par mois", async () => {
    const t = (jour) => Math.floor(new Date(`${jour}T12:00:00`).getTime() / 1000);
    const { appel, requetes } = reseau([
      {
        data: [
          { id: "txn_1", type: "charge", amount: 4900, fee: 150, currency: "eur", created: t("2026-10-03"), description: "Premium" },
          { id: "txn_2", type: "payout", amount: -4000, fee: 0, currency: "eur", created: t("2026-10-04") },
        ],
        has_more: true,
      },
      { data: [{ id: "txn_3", type: "refund", amount: -900, fee: 0, currency: "eur", created: t("2026-10-05") }], has_more: false },
    ]);
    const lignes = await definition("stripe").synchroniser({ secret: { cle: "rk_live_x" }, depuis: "2026-10-01", appel, aujourdhui: "2026-10-27" });
    expect(lignes.map((l) => [l.sens, l.ref, l.montantCents])).toEqual([
      ["revenu", "stripe-txn_1", 4900],
      ["revenu", "stripe-txn_3", -900],
      ["depense", "stripe-frais-2026-10", 150],
    ]);
    expect(requetes[1].url).toContain("starting_after=txn_2");
  });
});
