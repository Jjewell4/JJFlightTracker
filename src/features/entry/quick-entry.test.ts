import { beforeAll, describe, expect, it } from "vitest";
import { installReference } from "@/test/reference-fixture";
import { parseQuickEntry } from "./quick-entry";
beforeAll(installReference);
describe("quick entry", () => {
  it("recognizes a route, date and optional flight number", () => {
    expect(parseQuickEntry("SAN → LAX 2026-11-15 UA 123")).toMatchObject({
      from: "KSAN",
      to: "KLAX",
      date: "2026-11-15",
      flightNumber: "UA123",
    });
    expect(parseQuickEntry("KSAN to KLAX 2026-11-15")).toMatchObject({
      from: "KSAN",
      to: "KLAX",
    });
  });
  it("rejects ambiguous or invalid input without guessing", () => {
    for (const text of [
      "SAN LAX 11/15/26",
      "SAN-LAX 2026-02-30",
      "ZZZZ-LAX 2026-11-15",
      "SAN-SAN 2026-11-15",
      "Confirmation: SAN-LAX 2026-11-15",
    ])
      expect(parseQuickEntry(text)).toBeNull();
  });
});
