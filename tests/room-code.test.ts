import { describe, expect, it } from "vitest";
import {
  ADJETIVOS,
  SUBSTANTIVOS,
  formatRoomCode,
  generateRoomCode,
  normalizeRoomCode,
} from "../packages/shared/src/room-code.js";

describe("generateRoomCode", () => {
  it("matches noun-adjective slug and is deterministic with injected rand", () => {
    const code = generateRoomCode((n) => {
      expect(n).toBeGreaterThan(0);
      return 0;
    });
    expect(code).toBe(`${SUBSTANTIVOS[0]}-${ADJETIVOS[0]}`);
    expect(code).toMatch(/^[a-z]+-[a-z]+$/);
  });
});

describe("word lists", () => {
  it("has at least 60 nouns and 60 adjectives", () => {
    expect(SUBSTANTIVOS.length).toBeGreaterThanOrEqual(60);
    expect(ADJETIVOS.length).toBeGreaterThanOrEqual(60);
  });

  it("every word is already normalized (no accent, hyphen, or uppercase)", () => {
    for (const word of [...SUBSTANTIVOS, ...ADJETIVOS]) {
      expect(normalizeRoomCode(word)).toBe(word);
    }
  });
});

describe("normalizeRoomCode", () => {
  it("accepts spaced, hyphenated, and accented input", () => {
    expect(normalizeRoomCode("  Morangô Exemplar ")).toBe("morango-exemplar");
    expect(normalizeRoomCode("MORANGO-EXEMPLAR")).toBe("morango-exemplar");
    expect(normalizeRoomCode("morango exemplar")).toBe("morango-exemplar");
  });

  it("extracts room code from full URLs or query params", () => {
    expect(
      normalizeRoomCode("https://trucoviski.app/?sala=morango-exemplar"),
    ).toBe("morango-exemplar");
    expect(
      normalizeRoomCode("http://localhost:5173/?sala=abacaxi-brilhante"),
    ).toBe("abacaxi-brilhante");
    expect(normalizeRoomCode("?sala=tamandua-quieto")).toBe("tamandua-quieto");
  });

  it("is idempotent", () => {
    const samples = [
      "  Morangô Exemplar ",
      "MORANGO-EXEMPLAR",
      "morango exemplar",
      "xKf9aQ2mZ",
    ];
    for (const sample of samples) {
      const once = normalizeRoomCode(sample);
      expect(normalizeRoomCode(once)).toBe(once);
    }
  });
});

describe("formatRoomCode", () => {
  it("joins generated codes with exactly one space", () => {
    const formatted = formatRoomCode(generateRoomCode(() => 0));
    expect(formatted.split(" ")).toHaveLength(2);
    expect(formatted).toBe(`${SUBSTANTIVOS[0]} ${ADJETIVOS[0]}`);
  });
});
