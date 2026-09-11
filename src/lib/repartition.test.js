import { describe, expect, it } from "vitest";
import { repartir, repartirEntreSites } from "./repartition";

describe("repartir", () => {
  it("partage un montant divisible a parts egales", () => {
    expect(repartir(1100, 2)).toEqual([550, 550]);
  });

  it("distribue le reste au centime pres, sans en perdre ni en inventer", () => {
    // 11,00 EUR sur 3 sites: 3,67 + 3,67 + 3,66 = 11,00 exactement
    const parts = repartir(1100, 3);
    expect(parts).toEqual([367, 367, 366]);
    expect(parts.reduce((t, p) => t + p, 0)).toBe(1100);
  });

  it("conserve le total quel que soit le nombre de sites", () => {
    for (let n = 1; n <= 12; n += 1) {
      for (const montant of [1, 7, 999, 1100, 123456]) {
        const somme = repartir(montant, n).reduce((t, p) => t + p, 0);
        expect(somme).toBe(montant);
      }
    }
  });

  it("gere un montant plus petit que le nombre de sites", () => {
    expect(repartir(2, 5)).toEqual([1, 1, 0, 0, 0]);
  });

  it("renvoie une liste vide sans site", () => {
    expect(repartir(1000, 0)).toEqual([]);
  });

  it("refuse un montant qui n'est pas en centimes entiers", () => {
    expect(() => repartir(11.5, 2)).toThrow(TypeError);
  });
});

describe("repartirEntreSites", () => {
  it("associe chaque site a sa part", () => {
    expect(repartirEntreSites(1100, [3, 7, 9])).toEqual([
      { siteId: 3, partCents: 367 },
      { siteId: 7, partCents: 367 },
      { siteId: 9, partCents: 366 },
    ]);
  });
});
