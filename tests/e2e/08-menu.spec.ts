/* ------------------------------------------------------------------ */
/*  Teste E2E: menu Home — versus, layout 390px, teclado               */
/* ------------------------------------------------------------------ */

import { test, expect } from "@playwright/test";

test.describe("Menu Home", () => {
  test("nome vazio desabilita todos os caminhos", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("home-screen")).toBeVisible();

    await expect(page.getByTestId("play-bots-btn")).toBeDisabled();
    await expect(page.getByTestId("create-room-btn")).toBeDisabled();
    await expect(page.getByTestId("join-room-btn")).toBeDisabled();

    await page.getByTestId("nickname-input").fill("Bruno");
    await expect(page.getByTestId("play-bots-btn")).toBeEnabled();
    await expect(page.getByTestId("create-room-btn")).toBeEnabled();
    await expect(page.getByTestId("join-room-btn")).toBeDisabled();

    await page.getByTestId("room-id-input").fill("abc");
    await expect(page.getByTestId("join-room-btn")).toBeEnabled();
  });

  test("gerar nome preenche o campo com um nome do pool", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("home-screen")).toBeVisible();
    await expect(page.getByTestId("nickname-input")).toHaveValue("");

    await page.getByTestId("generate-name-btn").click();
    const first = await page.getByTestId("nickname-input").inputValue();
    expect(first.length).toBeGreaterThan(0);
    await expect(page.getByTestId("play-bots-btn")).toBeEnabled();

    await page.getByTestId("generate-name-btn").click();
    const second = await page.getByTestId("nickname-input").inputValue();
    expect(second.length).toBeGreaterThan(0);
    // evita repetir o nome atual ao clicar de novo
    expect(second).not.toBe(first);
  });

  test("versus: criar sala abre lobby; segundo jogador entra por código", async ({
    browser,
  }) => {
    test.setTimeout(60000);
    const owner = await browser.newPage();
    const other = await browser.newPage();

    try {
      await owner.goto("/");
      await owner.getByTestId("nickname-input").fill("Dono");
      await owner.getByTestId("create-room-btn").click();

      await expect(owner.getByTestId("lobby-screen")).toBeVisible({
        timeout: 15000,
      });
      await expect(owner.getByTestId("player-count")).toContainText("1 / 4");
      await expect(owner.getByTestId("lobby-seat-0")).toContainText("Dono");

      const roomCode = await owner.getByTestId("room-code").textContent();
      if (!roomCode) throw new Error("room code not captured");

      await other.goto("/");
      await other.getByTestId("nickname-input").fill("Convidado");
      await other.getByTestId("room-id-input").fill(roomCode);
      await other.getByTestId("join-room-btn").click();

      await expect(other.getByTestId("lobby-screen")).toBeVisible({
        timeout: 15000,
      });
      await expect(owner.getByTestId("player-count")).toContainText("2 / 4", {
        timeout: 10000,
      });
      await expect(owner.getByTestId("lobby-seat-0")).toContainText("Dono");
      await expect(owner.getByTestId("lobby-seat-1")).toContainText(
        "Convidado",
      );
      await expect(owner.getByTestId("fill-bots-btn")).toBeVisible();
    } finally {
      await owner.close();
      await other.close();
    }
  });

  test("layout utilizável em viewport 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const home = page.getByTestId("home-screen");
    await expect(home).toBeVisible();

    for (const testId of [
      "nickname-input",
      "generate-name-btn",
      "play-bots-btn",
      "versus-section",
      "create-room-btn",
      "room-id-input",
      "join-room-btn",
    ]) {
      const el = page.getByTestId(testId);
      await expect(el).toBeVisible();
      const box = await el.boundingBox();
      expect(box).not.toBeNull();
      if (!box) throw new Error(`${testId} sem bounding box`);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      if (testId.endsWith("-btn") || testId.endsWith("-input")) {
        expect(box.height).toBeGreaterThanOrEqual(40);
      }
    }

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(400);
  });

  test("navegação por teclado com foco visível", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nickname-input").fill("Teclado");
    await page.getByTestId("room-id-input").fill("sala");

    await page.getByTestId("nickname-input").focus();
    await expect(page.getByTestId("nickname-input")).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(page.getByTestId("generate-name-btn")).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(page.getByTestId("play-bots-btn")).toBeFocused();

    const focusStyle = await page
      .getByTestId("play-bots-btn")
      .evaluate((el) => {
        const styles = getComputedStyle(el);
        return {
          boxShadow: styles.boxShadow,
          outlineWidth: styles.outlineWidth,
        };
      });
    expect(
      focusStyle.boxShadow !== "none" ||
        parseFloat(focusStyle.outlineWidth) > 0,
    ).toBe(true);

    await page.keyboard.press("Tab");
    await expect(page.getByTestId("create-room-btn")).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(page.getByTestId("room-id-input")).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(page.getByTestId("join-room-btn")).toBeFocused();
  });
});
