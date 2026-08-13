import { describe, expect, it } from "vitest";
import { avatarUrl } from "../apps/web/src/utils/avatar.js";

describe("avatarUrl", () => {
  it("usa pixel-art do DiceBear com seed e círculo", () => {
    const url = avatarUrl("Lara Croft", 96);
    expect(url).toContain("https://api.dicebear.com/10.x/pixel-art/svg");
    expect(url).toContain("seed=Lara+Croft");
    expect(url).toContain("size=96");
    expect(url).toContain("borderRadius=50");
  });

  it("mesmo seed produz a mesma URL", () => {
    expect(avatarUrl("Ahri")).toBe(avatarUrl("Ahri"));
  });

  it("seed vazio recai em jogador", () => {
    expect(avatarUrl("")).toBe(avatarUrl("   "));
    expect(avatarUrl("")).toContain("seed=jogador");
  });
});
