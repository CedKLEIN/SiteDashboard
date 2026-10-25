import { describe, expect, it } from "vitest";
import { analyserIntegrite, horodatage, sauvegardeDue } from "./sauvegarde";

describe("analyserIntegrite", () => {
  it("distingue une base saine, un index a reconstruire et une base abimee", () => {
    expect(analyserIntegrite(["ok"])).toBe("ok");
    // Le cas constate le 25/10/2026
    expect(
      analyserIntegrite([
        "row 1 missing from index idx_verifications_check",
        "wrong # of entries in index idx_verifications_check",
      ]),
    ).toBe("index");
    expect(analyserIntegrite(["*** in database main ***\nPage 12: btreeInitPage() returns error code 11"])).toBe(
      "grave",
    );
  });
});

describe("horodatage", () => {
  it("donne un nom triable, en heure locale", () => {
    expect(horodatage(new Date(2026, 9, 5, 9, 7))).toBe("2026-10-05_0907");
  });
});

describe("sauvegardeDue", () => {
  const maintenant = new Date("2026-10-25T12:00:00Z");

  it("est due sans sauvegarde precedente ou avec une date illisible", () => {
    expect(sauvegardeDue(null, maintenant)).toBe(true);
    expect(sauvegardeDue("pas une date", maintenant)).toBe(true);
  });

  it("attend une semaine pleine entre deux sauvegardes", () => {
    expect(sauvegardeDue("2026-10-19T12:00:01Z", maintenant)).toBe(false);
    expect(sauvegardeDue("2026-10-18T12:00:00Z", maintenant)).toBe(true);
  });
});
