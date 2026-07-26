/* ------------------------------------------------------------------ */
/*  Teste E2E: menu — bots direto + versus no lobby                    */
/* ------------------------------------------------------------------ */

import { test, expect, type Page } from "@playwright/test";

async function getScores(page: Page): Promise<[number, number] | null> {
  try {
    const score0Text = await page
      .locator('[data-testid="score-team-0"]')
      .textContent({ timeout: 2000 });
    const score1Text = await page
      .locator('[data-testid="score-team-1"]')
      .textContent({ timeout: 2000 });

    if (score0Text && score1Text) {
      const score0 = parseInt(score0Text.match(/\d+/)?.[0] ?? "", 10);
      const score1 = parseInt(score1Text.match(/\d+/)?.[0] ?? "", 10);

      if (!isNaN(score0) && !isNaN(score1)) {
        return [score0, score1];
      }
    }
  } catch {
    // Ignora
  }

  try {
    const myTeamText = await page
      .locator('[data-testid="end-score-my-team"]')
      .textContent({ timeout: 2000 });
    const oppTeamText = await page
      .locator('[data-testid="end-score-opp-team"]')
      .textContent({ timeout: 2000 });

    if (myTeamText && oppTeamText) {
      const myMatch = myTeamText.match(/(\d+)\s*tentos/);
      const oppMatch = oppTeamText.match(/(\d+)\s*tentos/);

      if (myMatch && oppMatch) {
        return [parseInt(myMatch[1], 10), parseInt(oppMatch[1], 10)];
      }
    }
  } catch {
    // Ignora
  }

  return null;
}

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

test.describe("Partida completa com bots", () => {
  test("1 humano + 3 bots via Jogar contra bots até Fim de Partida", async ({
    page,
  }) => {
    test.setTimeout(300000);

    await page.goto("/");
    await expect(page.locator("h1:has-text('Truco Paulista')")).toBeVisible({
      timeout: 10000,
    });

    const nicknameInput = page.locator('[data-testid="nickname-input"]');
    await expect(nicknameInput).toBeVisible({ timeout: 5000 });
    await nicknameInput.fill("Humano");

    const playBotsBtn = page.locator('[data-testid="play-bots-btn"]');
    await expect(playBotsBtn).toBeVisible();
    await expect(playBotsBtn).toBeEnabled();
    await playBotsBtn.click();

    // Modo bots pula o lobby — vai direto à mesa
    await expect(page.locator('[data-testid="mesa-screen"]')).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator('[data-testid="lobby-screen"]')).toHaveCount(0);

    await expect(page.locator('[data-testid="hand-area"]')).toBeVisible({
      timeout: 10000,
    });

    // Humano + 3 bots visíveis nos assentos (bots usam nomes do pool)
    await expect(page.locator('[data-testid="seat-0"]')).toContainText(
      "Humano",
    );
    for (const seat of [1, 2, 3] as const) {
      const seatEl = page.locator(`[data-testid="seat-${seat}"]`);
      await expect(seatEl).toBeVisible();
      const text = await seatEl.innerText();
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).not.toContain("Humano");
      expect(text).not.toMatch(/^Bot \d/);
    }

    const initialScores = await getScores(page);
    expect(initialScores).not.toBeNull();

    let matchFinished = false;
    let iterations = 0;
    const maxIterations = 500;

    while (!matchFinished && iterations < maxIterations) {
      iterations++;

      const endScreen = page.locator('[data-testid="end-screen"]');
      const isEndVisible = await endScreen
        .isVisible({ timeout: 100 })
        .catch(() => false);

      if (isEndVisible) {
        matchFinished = true;
        break;
      }

      await playOneIteration(page);
      await page.waitForTimeout(750);
    }

    expect(matchFinished).toBe(true);

    await expect(page.locator('[data-testid="end-screen"]')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="end-heading"]')).toBeVisible();

    const resultText = await page
      .locator('[data-testid="end-result"]')
      .textContent();
    expect(resultText).toMatch(/Vitória!|Derrota/);

    const finalScores = await getScores(page);
    expect(finalScores).not.toBeNull();
    if (!finalScores) throw new Error("Scores não disponíveis");
    expect(Math.max(finalScores[0], finalScores[1])).toBeGreaterThanOrEqual(12);

    const winnerText = await page
      .locator('[data-testid="end-winner"]')
      .textContent();
    expect(winnerText).toContain("Time vencedor:");

    await expect(
      page.locator('[data-testid="end-replay-metadata"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="end-home-btn"]')).toBeVisible();
  });
});
