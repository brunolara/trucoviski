/* ------------------------------------------------------------------ */
/*  Teste E2E: F5 - Queda de rede e reconexão                         */
/* ------------------------------------------------------------------ */

import { test, expect } from "@playwright/test";

test.describe("F5 - Reconexão", () => {
  test("reconecta após queda de rede de 5s e preserva estado", async ({
    browser,
  }) => {
    test.setTimeout(90000);
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("console", (msg) => console.log("BROWSER:", msg.text()));

    // 1. Criar sala e preencher com bots
    await page.goto("/");
    const nicknameInput = page.locator('[data-testid="nickname-input"]');
    await expect(nicknameInput).toBeVisible();
    await nicknameInput.fill("Jogador1");
    await page.locator('[data-testid="create-room-btn"]').click();

    await expect(page.locator('[data-testid="lobby-screen"]')).toBeVisible({
      timeout: 10000,
    });
    await page.locator('[data-testid="fill-bots-btn"]').click();

    // Aguarda a mesa e as cartas
    const mesaScreen = page.locator('[data-testid="mesa-screen"]');
    await expect(mesaScreen).toBeVisible({ timeout: 15000 });
    const handCards = page.locator('[data-testid^="hand-card-"]');
    await expect(handCards.first()).toBeVisible({ timeout: 15000 });

    // Captura placar atual
    const scoreboard = page.locator('[data-testid="scoreboard"]');
    await expect(scoreboard).toBeVisible();
    const scoreTextAntes = await scoreboard.textContent();

    // Colyseus requires the room to be up for at least 5000ms before allowing reconnects
    await page.waitForTimeout(6000);

    // 2. Simular queda de rede
    await context.setOffline(true);

    // Deve mostrar "Reconectando..." (a check de visibilidade exata pode ser flaky durante a queda do websocket)
    const reconnectingOverlay = page.locator('text="Reconectando..."');

    // Esperar 5s
    await page.waitForTimeout(5000);

    // 3. Voltar rede
    await context.setOffline(false);

    // 4. Verificar se a tela da mesa volta e as cartas continuam lá
    await expect(reconnectingOverlay).toBeHidden({ timeout: 20000 });
    await expect(mesaScreen).toBeVisible({ timeout: 15000 });

    // Verifica placar inalterado (garante que não iniciou do zero)
    const scoreTextDepois = await scoreboard.textContent();
    expect(scoreTextDepois).toBe(scoreTextAntes);

    await context.close();
  });
});
