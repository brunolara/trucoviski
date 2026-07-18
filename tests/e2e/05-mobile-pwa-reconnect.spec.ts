/* ------------------------------------------------------------------ */
/*  Testes E2E: F5 - PWA e queda de rede                              */
/* ------------------------------------------------------------------ */

import { test, expect } from "@playwright/test";

test.describe("F5 - PWA e reconexão", () => {
  test("publica manifest e service worker que controla a página", async ({
    page,
  }) => {
    await page.goto("/");

    const manifestHref = await page
      .locator('link[rel="manifest"]')
      .getAttribute("href");
    expect(manifestHref).toBeTruthy();
    if (!manifestHref) throw new Error("PWA manifest link is missing");

    const manifest = await page.request.get(manifestHref);
    expect(manifest.ok()).toBe(true);
    expect(await manifest.json()).toEqual(
      expect.objectContaining({ name: "Trucoviski", display: "standalone" }),
    );

    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect
      .poll(() =>
        page.evaluate(() => navigator.serviceWorker.controller !== null),
      )
      .toBe(true);
  });

  test("reconecta após queda de rede de 5s e preserva a mão", async ({
    browser,
  }) => {
    test.setTimeout(90000);
    const context = await browser.newContext({ serviceWorkers: "allow" });
    const page = await context.newPage();

    try {
      await page.goto("/");
      const nicknameInput = page.getByTestId("nickname-input");
      await expect(nicknameInput).toBeVisible();
      await nicknameInput.fill("Jogador1");
      await page.getByTestId("create-room-btn").click();

      await expect(page.getByTestId("lobby-screen")).toBeVisible({
        timeout: 10000,
      });
      await page.getByTestId("fill-bots-btn").click();

      const mesaScreen = page.getByTestId("mesa-screen");
      await expect(mesaScreen).toBeVisible({ timeout: 15000 });
      const handCards = page.locator('[data-testid^="hand-card-"]');
      await expect(handCards.first()).toBeVisible({ timeout: 15000 });

      const roomId = await mesaScreen.getAttribute("data-room-id");
      expect(roomId).toBeTruthy();
      if (!roomId) throw new Error("Mesa is missing its room id");
      const privateCardsBefore = await handCards.allTextContents();
      expect(privateCardsBefore).toHaveLength(3);

      // Colyseus só aceita a reserva de reconexão após cinco segundos.
      await page.waitForTimeout(6000);
      await context.setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));

      const reconnectingOverlay = page.getByTestId("reconnecting-overlay");
      await expect(reconnectingOverlay).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(5000);

      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));

      await expect(reconnectingOverlay).toBeHidden({ timeout: 20000 });
      await expect(mesaScreen).toBeVisible({ timeout: 15000 });
      await expect(mesaScreen).toHaveAttribute("data-room-id", roomId);
      await expect(handCards).toHaveCount(3);
      expect(await handCards.allTextContents()).toEqual(privateCardsBefore);
    } finally {
      await context.close();
    }
  });
});
