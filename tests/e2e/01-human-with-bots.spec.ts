/* ------------------------------------------------------------------ */
/*  Teste E2E: 1 humano + 3 bots completa PARTIDA via UI              */
/* ------------------------------------------------------------------ */

import { test, expect, type Page } from "@playwright/test";

/**
 * Helper: Captura score atual de uma página (mesa ou fim)
 */
async function getScores(page: Page): Promise<[number, number] | null> {
  // Tenta scoreboard da mesa primeiro
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

  // Tenta extrair da tela de fim
  try {
    const myTeamText = await page
      .locator('[data-testid="end-score-my-team"]')
      .textContent({ timeout: 2000 });
    const oppTeamText = await page
      .locator('[data-testid="end-score-opp-team"]')
      .textContent({ timeout: 2000 });

    if (myTeamText && oppTeamText) {
      // "Seu time (Nós): 10 tentos"
      const myMatch = myTeamText.match(/(\d+)\s*tentos/);
      const oppMatch = oppTeamText.match(/(\d+)\s*tentos/);

      if (myMatch && oppMatch) {
        const myScore = parseInt(myMatch[1], 10);
        const oppScore = parseInt(oppMatch[1], 10);
        // Retorna [team0, team1] - assume que "Nós" é team 0
        return [myScore, oppScore];
      }
    }
  } catch {
    // Ignora
  }

  return null;
}

/**
 * Helper: Tenta jogar uma carta se for a vez do jogador
 */
async function tryPlayCard(page: Page): Promise<boolean> {
  const playButton = page.locator('[data-testid^="play-card-btn-"]').first();
  if (!(await playButton.isVisible())) return false;
  await playButton.click({ force: true, timeout: 3000 });
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

/**
 * Helper: Executa uma iteração do loop de jogo
 */
async function playOneIteration(page: Page): Promise<void> {
  await tryDecideEleven(page);
  await tryRespondTruco(page);
  await tryPlayCard(page);
}

test.describe("Partida completa com bots", () => {
  test("1 humano + 3 bots jogam partida completa até Fim de Partida", async ({
    page,
  }) => {
    test.setTimeout(300000); // 5 minutos para partida completa

    // Navega para a home
    await page.goto("/");

    // Aguarda a home carregar
    await expect(page.locator("h1:has-text('Truco Paulista')")).toBeVisible({
      timeout: 10000,
    });

    // Preenche nickname
    const nicknameInput = page.locator('[data-testid="nickname-input"]');
    await expect(nicknameInput).toBeVisible({ timeout: 5000 });
    await nicknameInput.fill("Humano");

    // Cria sala
    const createButton = page.locator('[data-testid="create-room-btn"]');
    await expect(createButton).toBeVisible();
    await expect(createButton).toBeEnabled();
    await createButton.click();

    // Aguarda transição para lobby
    await expect(page.locator('[data-testid="lobby-screen"]')).toBeVisible({
      timeout: 15000,
    });

    // Verifica código da sala
    await expect(page.locator('[data-testid="room-code"]')).toBeVisible();

    // Verifica que há 1 jogador
    await expect(page.locator('[data-testid="player-count"]')).toContainText(
      "1 / 4",
    );

    // Clica em "Preencher com Bots"
    const fillBotsButton = page.locator('[data-testid="fill-bots-btn"]');
    await expect(fillBotsButton).toBeVisible();
    await fillBotsButton.click();

    // Aguarda transição para mesa (partida iniciada)
    await expect(page.locator('[data-testid="lobby-screen"]')).toBeHidden({
      timeout: 20000,
    });

    // Verifica que está na mesa (placar visível)
    await expect(page.locator('[data-testid="mesa-screen"]')).toBeVisible({
      timeout: 15000,
    });

    // Verifica que há cartas visíveis (mão do jogador) ou área de mão
    await expect(page.locator('[data-testid="hand-area"]')).toBeVisible({
      timeout: 10000,
    });

    // Captura scores iniciais
    const initialScores = await getScores(page);
    expect(initialScores).not.toBeNull();

    // Loop para completar PARTIDA (até tela de fim aparecer)
    let matchFinished = false;
    let iterations = 0;
    const maxIterations = 500; // Limite de segurança para partida completa

    while (!matchFinished && iterations < maxIterations) {
      iterations++;

      // Verifica se a tela de fim apareceu
      const endScreen = page.locator('[data-testid="end-screen"]');
      const isEndVisible = await endScreen
        .isVisible({ timeout: 100 })
        .catch(() => false);

      if (isEndVisible) {
        matchFinished = true;
        break;
      }

      // Executa uma iteração do jogo
      await playOneIteration(page);

      // Pausa entre iterações (bots jogam automaticamente)
      await page.waitForTimeout(750);
    }

    // Verifica que a partida terminou
    expect(matchFinished).toBe(true);

    // Aguarda a tela de fim estar completamente visível
    await expect(page.locator('[data-testid="end-screen"]')).toBeVisible({
      timeout: 5000,
    });

    // Verifica heading "Fim de Partida"
    await expect(page.locator('[data-testid="end-heading"]')).toBeVisible();

    // Verifica resultado (Vitória ou Derrota)
    const resultText = await page
      .locator('[data-testid="end-result"]')
      .textContent();
    expect(resultText).toMatch(/Vitória!|Derrota/);

    // Verifica placar final - vencedor deve ter >=12 tentos
    const finalScores = await getScores(page);
    expect(finalScores).not.toBeNull();
    if (!finalScores) throw new Error("Scores não disponíveis");
    const [score0, score1] = finalScores;
    const winnerScore = Math.max(score0, score1);
    expect(winnerScore).toBeGreaterThanOrEqual(12);

    // Verifica que há um vencedor declarado
    const winnerText = await page
      .locator('[data-testid="end-winner"]')
      .textContent();
    expect(winnerText).toContain("Time vencedor:");

    // Verifica replay metadata presente
    const replayMetadata = page.locator('[data-testid="end-replay-metadata"]');
    await expect(replayMetadata).toBeVisible();

    // Verifica seed presente
    const seedText = await page
      .locator('[data-testid="end-replay-seed"]')
      .textContent();
    expect(seedText).toContain("Seed:");

    // Verifica ruleset presente
    const rulesetText = await page
      .locator('[data-testid="end-replay-ruleset"]')
      .textContent();
    expect(rulesetText).toContain("Ruleset:");

    // Verifica botão de voltar ao início
    await expect(page.locator('[data-testid="end-home-btn"]')).toBeVisible();
  });
});
