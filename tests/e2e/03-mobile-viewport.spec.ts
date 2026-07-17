/* ------------------------------------------------------------------ */
/*  Teste E2E: Viewport 390px (mobile) permanece utilizável           */
/* ------------------------------------------------------------------ */

import { test, expect } from "@playwright/test";

test.describe("Mobile viewport", () => {
  test("viewport 390px permanece utilizável", async ({ page }) => {
    test.setTimeout(90000); // 90 segundos

    // Configura viewport mobile (390px de largura)
    await page.setViewportSize({ width: 390, height: 844 }); // iPhone 12/13/14

    // Navega para a home
    await page.goto("/");

    // Verifica que a home é visível e utilizável
    const title = page.locator("h1:has-text('Truco Paulista')");
    await expect(title).toBeVisible();

    // Preenche nickname primeiro (botão só habilita após preencher)
    const nicknameInput = page.locator('[data-testid="nickname-input"]');
    await expect(nicknameInput).toBeVisible();
    await expect(nicknameInput).toBeEnabled();
    await nicknameInput.fill("Mobile");

    // Agora verifica que o botão de criar sala está habilitado
    const createButton = page.locator('[data-testid="create-room-btn"]');
    await expect(createButton).toBeVisible();
    await expect(createButton).toBeEnabled();

    // Verifica que o input de código da sala é visível
    const roomCodeInput = page.locator('[data-testid="room-id-input"]');
    await expect(roomCodeInput).toBeVisible();

    // Verifica que o botão de entrar é visível
    const joinButton = page.locator('[data-testid="join-room-btn"]');
    await expect(joinButton).toBeVisible();

    // Cria sala
    await createButton.click();

    // Aguarda transição para lobby
    await expect(page.locator('[data-testid="lobby-screen"]')).toBeVisible({
      timeout: 10000,
    });

    // Verifica que o lobby é utilizável em mobile
    const lobbyTitle = page.locator("h2:has-text('Sala de Espera')");
    await expect(lobbyTitle).toBeVisible();

    // Verifica que os assentos são visíveis
    const seats = page.locator('[class*="seat"]');
    await expect(seats.first()).toBeVisible();

    // Verifica que o botão de preencher com bots é visível
    const fillBotsButton = page.locator('[data-testid="fill-bots-btn"]');
    await expect(fillBotsButton).toBeVisible();
    await expect(fillBotsButton).toBeEnabled();

    // Verifica que o botão de sair é visível
    const leaveButton = page.locator('[data-testid="leave-btn"]');
    await expect(leaveButton).toBeVisible();

    // Clica em preencher com bots
    await fillBotsButton.click();

    // Aguarda transição para mesa
    await expect(page.locator('[data-testid="lobby-screen"]')).toBeHidden({
      timeout: 30000,
    });

    // Verifica que a mesa é utilizável em mobile
    const mesaScreen = page.locator('[data-testid="mesa-screen"]');
    await expect(mesaScreen).toBeVisible({ timeout: 10000 });

    // Verifica que as cartas são visíveis e não estão cortadas
    const handCards = page.locator('[data-testid^="hand-card-"]');
    await expect(handCards.first()).toBeVisible({ timeout: 10000 });

    // Verifica que não há overflow horizontal (scroll horizontal)
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = page.viewportSize()?.width ?? 390;
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 10); // Margem de 10px para arredondamento

    // Verifica que o placar é visível
    const scoreboard = page.locator('[data-testid="scoreboard"]');
    await expect(scoreboard).toBeVisible();
  });
});
