/** DiceBear pixel-art — combina com o tema da mesa. Mesmo seed = mesmo retrato. */
const DICEBEAR_PIXEL_ART = "https://api.dicebear.com/10.x/pixel-art/svg";

export function avatarUrl(seed: string, size = 64): string {
  const url = new URL(DICEBEAR_PIXEL_ART);
  url.searchParams.set("seed", seed.trim() || "jogador");
  url.searchParams.set("size", String(size));
  url.searchParams.set("borderRadius", "50");
  return url.href;
}
