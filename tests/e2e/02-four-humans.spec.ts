/* ------------------------------------------------------------------ */
/*  Teste E2E: 4 abas humanas completam ao menos uma mão              */
/* ------------------------------------------------------------------ */

import { test, expect, type Page } from "@playwright/test";

/**
 * Helper: Captura score atual de uma página
 */
async function getScores(page: Page): Promise<[number, number] | null> {
  try {
    const score0Text = await page
      .locator('[data-testid="score-team-0"]')
      .textContent({ timeout: 2000 });
    const score1Text = await page
      .locator('[data-testid="score-team-1"]')
      .textContent({ timeout: 2000 });

    if (!score0Text || !score1Text) return null;

    const score0 = parseInt(score0Text.replace("Nós: ", "").trim(), 10);
    const score1 = parseInt(score1Text.replace("Eles: ", "").trim(), 10);

    if (isNaN(score0) || isNaN(score1)) return null;
    return [score0, score1];
  } catch {
    return null;
  }
}

/**
 * Helper: Tenta jogar uma carta se for a vez do jogador.
 * F5: jogar carta é via duplo-clique (desktop) / duplo-toque (mobile) no `.card`.
 */
async function tryPlayCard(page: Page): Promise<boolean> {
  const playCard = page.locator('[data-testid^="hand-card-"]').first();
  if (!(await playCard.isVisible())) return false;
  await playCard.dblclick({ force: true, timeout: 3000 });
  return true;
}

/**
 * Helper: Tenta decidir mão de onze se estiver visível
 */
async function tryDecideEleven(page: Page): Promise<boolean> {
  const playBtn = page.getByTestId("eleven-play-btn");
  if (!(await playBtn.isVisible())) return false;
  await playBtn.click({ force: true, timeout: 3000 });
  return true;
}

/**
 * Helper: Tenta responder truco se estiver visível
 */
async function tryRespondTruco(page: Page): Promise<boolean> {
  const acceptBtn = page.getByTestId("truco-accept-btn");
  if (!(await acceptBtn.isVisible())) return false;
  await acceptBtn.click({ force: true, timeout: 3000 });
  return true;
}

test.describe("Partida com 4 humanos", () => {
  test("4 abas humanas completam ao menos uma mão", async ({ browser }) => {
    test.setTimeout(180000); // 3 minutos para 4 jogadores

    const pages = await Promise.all([
      browser.newPage(),
      browser.newPage(),
      browser.newPage(),
      browser.newPage(),
    ]);

    const nicknames = ["Jogador1", "Jogador2", "Jogador3", "Jogador4"];

    try {
      // Primeiro jogador cria a sala
      await pages[0].goto("/");
      await pages[0]
        .locator('[data-testid="nickname-input"]')
        .fill(nicknames[0]);
      await pages[0].locator('[data-testid="create-room-btn"]').click();

      // Aguarda lobby
      await expect(
        pages[0].locator('[data-testid="lobby-screen"]'),
      ).toBeVisible({ timeout: 10000 });

      // Captura o código da sala
      const roomCodeLocator = pages[0].locator('[data-testid="room-code"]');
      await expect(roomCodeLocator).toBeVisible();
      const roomCode = await roomCodeLocator.textContent();
      if (!roomCode)
        throw new Error("Não foi possível capturar o código da sala");

      // Outros 3 jogadores entram na sala
      for (let i = 1; i < 4; i++) {
        await pages[i].goto("/");
        await pages[i]
          .locator('[data-testid="nickname-input"]')
          .fill(nicknames[i]);
        await pages[i].locator('[data-testid="room-id-input"]').fill(roomCode);
        await pages[i].locator('[data-testid="join-room-btn"]').click();
      }

      // Aguarda todos estarem na mesa (quarto jogador pode ir direto para mesa)
      for (const page of pages) {
        await expect(page.locator('[data-testid="mesa-screen"]')).toBeVisible({
          timeout: 30000,
        });
      }

      // Verifica que cada jogador vê suas cartas
      for (const page of pages) {
        const handCards = page.locator('[data-testid^="hand-card-"]');
        await expect(handCards.first()).toBeVisible({ timeout: 10000 });
        const cardCount = await handCards.count();
        expect(cardCount).toBeGreaterThanOrEqual(3); // Cada jogador tem 3 cartas
      }

      // Captura scores iniciais
      const initialScores = await getScores(pages[0]);
      expect(initialScores).not.toBeNull();

      // Loop para completar uma mão (até score mudar)
      let scoreChanged = false;
      let iterations = 0;
      const maxIterations = 100; // Limite de segurança

      while (!scoreChanged && iterations < maxIterations) {
        iterations++;

        // Tenta jogar em cada página
        for (const page of pages) {
          // Tenta decidir mão de onze
          await tryDecideEleven(page);

          // Tenta responder truco
          await tryRespondTruco(page);

          // Tenta jogar carta
          await tryPlayCard(page);

          // Pequena pausa entre ações
          await page.waitForTimeout(250);
        }

        // Verifica se o score mudou
        const currentScores = await getScores(pages[0]);
        if (
          currentScores &&
          initialScores &&
          (currentScores[0] !== initialScores[0] ||
            currentScores[1] !== initialScores[1])
        ) {
          scoreChanged = true;
        }

        // Pausa entre iterações
        await pages[0].waitForTimeout(500);
      }

      // Verifica que o score mudou (mão completada)
      expect(scoreChanged).toBe(true);

      // Verifica que pelo menos uma mão foi completada
      const finalScores = await getScores(pages[0]);
      expect(finalScores).not.toBeNull();
      const initial = initialScores ?? [0, 0];
      const final = finalScores ?? [0, 0];
      expect(final[0] > initial[0] || final[1] > initial[1]).toBe(true);
    } finally {
      // Fecha todas as páginas
      await Promise.all(pages.map((p) => p.close()));
    }
  });
});
