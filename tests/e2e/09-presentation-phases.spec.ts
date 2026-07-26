/* ------------------------------------------------------------------ */
/*  E2E: fases de apresentação — cartas congeladas + fim adiado        */
/* ------------------------------------------------------------------ */

import { test, expect, type Page } from "@playwright/test";

async function tryPlayCard(page: Page): Promise<boolean> {
  const playCard = page.locator('[data-testid^="hand-card-"]').first();
  if (!(await playCard.isVisible())) return false;
  await playCard.dblclick({ force: true, timeout: 3000 });
  return true;
}

async function tryDecideEleven(page: Page): Promise<boolean> {
  const playBtn = page.getByTestId("eleven-play-btn");
  if (!(await playBtn.isVisible())) return false;
  await playBtn.click({ force: true, timeout: 3000 });
  return true;
}

async function tryRespondTruco(page: Page): Promise<boolean> {
  const acceptBtn = page.getByTestId("truco-accept-btn");
  if (!(await acceptBtn.isVisible())) return false;
  await acceptBtn.click({ force: true, timeout: 3000 });
  return true;
}

async function playOneIteration(page: Page): Promise<void> {
  await tryDecideEleven(page);
  await tryRespondTruco(page);
  await tryPlayCard(page);
}

test.describe("Fases de apresentação (vaza / mão / partida)", () => {
  test("carta da vaza permanece no DOM enquanto o banner está visível", async ({
    page,
  }) => {
    test.setTimeout(120000);

    await page.goto("/");
    await page.locator('[data-testid="nickname-input"]').fill("Humano");
    await page.locator('[data-testid="play-bots-btn"]').click();

    await expect(page.locator('[data-testid="mesa-screen"]')).toBeVisible({
      timeout: 20000,
    });

    const banner = page.getByTestId("presentation-banner");
    let sawVazaBanner = false;
    const deadline = Date.now() + 90000;

    while (Date.now() < deadline && !sawVazaBanner) {
      await playOneIteration(page);

      const visible = await banner.isVisible().catch(() => false);
      if (visible) {
        const text = (await banner.textContent()) ?? "";
        if (/venceu a vaza|empatada/i.test(text)) {
          sawVazaBanner = true;
          await expect(
            page.locator('[data-testid^="played-card-"]').first(),
          ).toBeVisible();
          const winner = page.locator(
            '[data-testid^="played-card-"][data-winner="true"]',
          );
          // canga não tem winner; vaza normal tem
          if (!/empatada/i.test(text)) {
            await expect(winner).toHaveCount(1);
          }
          break;
        }
      }
      await page.waitForTimeout(200);
    }

    expect(sawVazaBanner).toBe(true);
  });

  test("tela end só aparece depois do banner final da mão", async ({
    page,
  }) => {
    test.setTimeout(300000);

    await page.goto("/");
    await page.locator('[data-testid="nickname-input"]').fill("Humano");
    await page.locator('[data-testid="play-bots-btn"]').click();

    await expect(page.locator('[data-testid="mesa-screen"]')).toBeVisible({
      timeout: 20000,
    });

    let sawHandBannerBeforeEnd = false;
    let matchFinished = false;
    let iterations = 0;

    while (!matchFinished && iterations < 500) {
      iterations++;

      const endVisible = await page
        .locator('[data-testid="end-screen"]')
        .isVisible({ timeout: 100 })
        .catch(() => false);
      if (endVisible) {
        matchFinished = true;
        break;
      }

      const banner = page.getByTestId("presentation-banner");
      const bannerVisible = await banner.isVisible().catch(() => false);
      if (bannerVisible) {
        const text = (await banner.textContent()) ?? "";
        if (/tento/i.test(text)) {
          await expect(
            page.locator('[data-testid="mesa-screen"]'),
          ).toBeVisible();
          await expect(page.locator('[data-testid="end-screen"]')).toHaveCount(
            0,
          );
          sawHandBannerBeforeEnd = true;
        }
      }

      await playOneIteration(page);
      await page.waitForTimeout(400);
    }

    expect(matchFinished).toBe(true);
    expect(sawHandBannerBeforeEnd).toBe(true);
    await expect(page.locator('[data-testid="end-screen"]')).toBeVisible();
  });
});
