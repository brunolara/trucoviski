/* ------------------------------------------------------------------ */
/*  Teste E2E: F5 — carta coberta, desistir, botões de truco, fix bots */
/* ------------------------------------------------------------------ */

import { test, expect } from "@playwright/test";

test.describe("F5: fillBots button visibility with 2+ humans", () => {
  test("owner sees fill-bots button and player count update after a 2nd human joins", async ({
    browser,
  }) => {
    test.setTimeout(60000);

    const owner = await browser.newPage();
    const other = await browser.newPage();

    try {
      await owner.goto("/");
      await owner.locator('[data-testid="nickname-input"]').fill("Dono");
      await owner.locator('[data-testid="create-room-btn"]').click();

      await expect(owner.locator('[data-testid="lobby-screen"]')).toBeVisible({
        timeout: 10000,
      });

      const roomCode = await owner
        .locator('[data-testid="room-code"]')
        .textContent();
      if (!roomCode) throw new Error("room code not captured");

      await owner.locator('[data-testid="fill-bots-btn"]').waitFor();

      await other.goto("/");
      await other.locator('[data-testid="nickname-input"]').fill("Outro");
      await other.locator('[data-testid="room-id-input"]').fill(roomCode);
      await other.locator('[data-testid="join-room-btn"]').click();

      // Owner's lobby view must update live to reflect the 2nd human
      // (this is the regression the F5 plan is meant to fix).
      await expect(owner.locator('[data-testid="player-count"]')).toContainText(
        "2 / 4",
        { timeout: 10000 },
      );

      // The fill-bots button must remain visible for the owner.
      const fillBotsButton = owner.locator('[data-testid="fill-bots-btn"]');
      await expect(fillBotsButton).toBeVisible();

      await fillBotsButton.click();
      await owner.locator('[data-testid="start-btn"]').click();

      // Both the owner and the 2nd human reach the mesa.
      await expect(owner.locator('[data-testid="mesa-screen"]')).toBeVisible({
        timeout: 20000,
      });
      await expect(other.locator('[data-testid="mesa-screen"]')).toBeVisible({
        timeout: 20000,
      });
    } finally {
      await owner.close();
      await other.close();
    }
  });
});

test.describe("F5: surrender button during a match", () => {
  test("surrender button is present during play (1 human + 3 bots)", async ({
    page,
  }) => {
    test.setTimeout(60000);

    await page.goto("/");
    await page.locator('[data-testid="nickname-input"]').fill("Humano");
    await page.locator('[data-testid="create-room-btn"]').click();

    await expect(page.locator('[data-testid="lobby-screen"]')).toBeVisible({
      timeout: 10000,
    });
    await page.locator('[data-testid="fill-bots-btn"]').click();
    await page.locator('[data-testid="start-btn"]').click();

    await expect(page.locator('[data-testid="mesa-screen"]')).toBeVisible({
      timeout: 20000,
    });

    await expect(page.locator('[data-testid="surrender-btn"]')).toBeVisible({
      timeout: 10000,
    });
  });
});
