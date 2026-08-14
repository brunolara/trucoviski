import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BOTS_SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  "../packages/bots/src",
);

describe("D-bot-1: bot só vê PlayerView", () => {
  it("packages/bots não importa MatchState, createMatch nem seed da partida", () => {
    const files = readdirSync(BOTS_SRC).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(join(BOTS_SRC, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/\bMatchState\b/);
      expect(src, f).not.toMatch(/\bcreateMatch\b/);
      expect(src, f).not.toMatch(/\bcreatePRNG\b/);
      expect(src, f).not.toMatch(/\bMatchMetadata\b/);
      expect(src, f).not.toMatch(/\bHandState\b/);
      expect(src, f).not.toMatch(/\bseed\b/);
    }
  });

  it("decideBotAction só recebe PlayerView", () => {
    const src = readFileSync(join(BOTS_SRC, "index.ts"), "utf8");
    expect(src).toMatch(
      /export function decideBotAction\(\s*view:\s*PlayerView\s*\)/,
    );
  });
});
