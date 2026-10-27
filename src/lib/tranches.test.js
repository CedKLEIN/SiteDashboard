import { describe, expect, it } from "vitest";
import { centile, cleTranche, formatTaux, latenceParDemiHeure, tauxTranches, tranchesCompletes } from "./tranches";

describe("tranches de disponibilite", () => {
  const maintenant = new Date(2026, 9, 27, 14, 20);

  it("complete les heures sans verification, la plus ancienne a gauche", () => {
    const tranches = tranchesCompletes([{ tranche: "2026-10-27 14", total: 4, ok: 3 }], { n: 3, maintenant });
    expect(tranches.map((t) => [t.debut, t.total, t.ok])).toEqual([
      ["2026-10-27 12", 0, 0],
      ["2026-10-27 13", 0, 0],
      ["2026-10-27 14", 4, 3],
    ]);
    expect(tauxTranches(tranches)).toBe(75);
  });

  it("decoupe aussi par jour", () => {
    expect(cleTranche(maintenant, true)).toBe("2026-10-27");
    const tranches = tranchesCompletes([], { n: 2, parJour: true, maintenant });
    expect(tranches.map((t) => t.debut)).toEqual(["2026-10-26", "2026-10-27"]);
    expect(tauxTranches(tranches)).toBeNull();
  });

  it("formate un taux sans l'arrondir vers le haut", () => {
    expect(formatTaux(99.999)).toBe("99,99 %");
    expect(formatTaux(100)).toBe("100 %");
    expect(formatTaux(null)).toBe("—");
  });
});

describe("latence", () => {
  it("donne mediane et 95e centile par demi-heure, sans les echecs", () => {
    expect(centile([5, 1, 3, 2, 4], 50)).toBe(3);
    const points = latenceParDemiHeure([
      { verifie_le: "2026-10-27 10:05:00", ok: 1, latence_ms: 100 },
      { verifie_le: "2026-10-27 10:15:00", ok: 1, latence_ms: 300 },
      { verifie_le: "2026-10-27 10:20:00", ok: 0, latence_ms: 9000 },
      { verifie_le: "2026-10-27 10:40:00", ok: 1, latence_ms: 200 },
    ]);
    expect(points).toEqual([
      { heure: "10:00", p50: 100, p95: 300 },
      { heure: "10:30", p50: 200, p95: 200 },
    ]);
  });
});
