import { test, expect, type Page } from "@playwright/test";

async function joinMesa(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Truco Paulista" }),
  ).toBeVisible({ timeout: 10000 });
  await page.locator('[data-testid="nickname-input"]').fill("Alinhamento");
  await page.locator('[data-testid="create-room-btn"]').click();
  await expect(page.locator('[data-testid="lobby-screen"]')).toBeVisible({
    timeout: 10000,
  });
  await page.locator('[data-testid="fill-bots-btn"]').click();
  await page.locator('[data-testid="start-btn"]').click();
  await expect(page.locator('[data-testid="mesa-screen"]')).toBeVisible({
    timeout: 20000,
  });
}

test.describe("Alinhamento dos assentos laterais", () => {
  test("esquerda e direita ficam na mesma altura e o avatar centra nas cartas", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await joinMesa(page);

    const left = page.locator('[data-rel-seat="3"]');
    const right = page.locator('[data-rel-seat="1"]');
    await expect(left).toBeVisible();
    await expect(right).toBeVisible();

    const leftBox = await left.boundingBox();
    const rightBox = await right.boundingBox();
    expect(leftBox).not.toBeNull();
    expect(rightBox).not.toBeNull();
    if (!leftBox || !rightBox) return;

    const leftMid = leftBox.y + leftBox.height / 2;
    const rightMid = rightBox.y + rightBox.height / 2;
    expect(Math.abs(leftMid - rightMid)).toBeLessThan(12);
    expect(Math.abs(leftBox.height - rightBox.height)).toBeLessThan(12);

    for (const seat of [left, right]) {
      const cards = seat.locator('[data-testid="seat-card-backs"]');
      const avatar = seat.locator('[data-testid="player-avatar"]');
      await expect(cards).toBeVisible();
      await expect(avatar).toBeVisible();
      const cardBox = await cards.boundingBox();
      const avatarBox = await avatar.boundingBox();
      expect(cardBox).not.toBeNull();
      expect(avatarBox).not.toBeNull();
      if (!cardBox || !avatarBox) return;
      const cardCx = cardBox.x + cardBox.width / 2;
      const avatarCx = avatarBox.x + avatarBox.width / 2;
      expect(Math.abs(cardCx - avatarCx)).toBeLessThan(8);
    }
  });
});
