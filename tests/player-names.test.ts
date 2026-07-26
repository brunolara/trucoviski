import { describe, expect, it } from "vitest";
import {
  NICKNAME_MAX_LENGTH,
  PLAYER_NAMES,
  pickRandomPlayerName,
  pickUniquePlayerNames,
} from "@trucoviski/shared";

describe("PLAYER_NAMES", () => {
  it("todos os nomes cabem no limite de nickname", () => {
    expect(PLAYER_NAMES.length).toBeGreaterThan(50);
    for (const name of PLAYER_NAMES) {
      expect(name.length).toBeGreaterThan(0);
      expect(name.length).toBeLessThanOrEqual(NICKNAME_MAX_LENGTH);
    }
  });

  it("pickUniquePlayerNames devolve nomes distintos e evita exclude", () => {
    const exclude = new Set(["Lara Croft", "Ahri"]);
    // rand determinístico: sempre o primeiro disponível
    const names = pickUniquePlayerNames(3, exclude, () => 0);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    for (const n of names) {
      expect(exclude.has(n)).toBe(false);
      expect(PLAYER_NAMES).toContain(n);
    }
  });

  it("pickRandomPlayerName evita o exclude", () => {
    const [first] = PLAYER_NAMES;
    expect(first).toBeDefined();
    const exclude = new Set(first === undefined ? [] : [first]);
    const name = pickRandomPlayerName(exclude, () => 0);
    expect(name).not.toBe(first);
    expect(PLAYER_NAMES).toContain(name);
  });
});
