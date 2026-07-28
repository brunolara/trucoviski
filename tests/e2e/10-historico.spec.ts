/* ------------------------------------------------------------------ */
/*  E2E: console de histórico da partida                               */
/* ------------------------------------------------------------------ */

import { test, expect, type Page } from "@playwright/test";

async function joinMesa(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Truco Paulista" }),
  ).toBeVisible({ timeout: 10000 });
  await page.locator('[data-testid="nickname-input"]').fill("Hist");
  await page.locator('[data-testid="create-room-btn"]').click();
  await expect(page.locator('[data-testid="lobby-screen"]')).toBeVisible({
    timeout: 10000,
  });
  await page.locator('[data-testid="fill-bots-btn"]').click();
  await expect(page.locator('[data-testid="mesa-screen"]')).toBeVisible({
    timeout: 20000,
  });
}

async function tryPlayCard(page: Page): Promise<boolean> {
  const playCard = page.locator('[data-testid^="hand-card-"]').first();
  if (!(await playCard.isVisible().catch(() => false))) return false;
  await playCard.dblclick({ force: true, timeout: 3000 }).catch(() => {});
  return true;
}

test.describe("Console de histórico", () => {
  test("abre o painel, registra jogada e fecha por botão e Escape", async ({
    page,
  }) => {
    test.setTimeout(60000);

    await joinMesa(page);

    const toggle = page.getByTestId("log-toggle-btn");
    await expect(toggle).toBeVisible();
    await toggle.click();

    const panel = page.getByTestId("log-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/Mão 1/)).toBeVisible();

    await page.getByTestId("log-close-btn").click();
    await expect(panel).toBeHidden();

    // Joga com o painel fechado (tenta algumas vezes se bots agem primeiro).
    for (let i = 0; i < 12; i++) {
      if (await tryPlayCard(page)) break;
      await page.waitForTimeout(500);
    }

    await toggle.click();
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/jogou/)).toBeVisible({ timeout: 15000 });

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });
});
