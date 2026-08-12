/* ------------------------------------------------------------------ */
/*  Teste E2E: Viewport 390px (mobile) permanece utilizável           */
/* ------------------------------------------------------------------ */

import { test, expect } from "@playwright/test";

test.describe("Mobile viewport", () => {
  test("viewport mobile permanece utilizável", async ({ page }, testInfo) => {
    test.setTimeout(90000); // 90 segundos
    test.skip(!testInfo.project.name.startsWith("mobile-"));

    // Navega para a home
    await page.goto("/");

    // Verifica que a home é visível e utilizável
    const title = page.getByRole("heading", { name: "Truco Paulista" });
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
    const lobbyTitle = page.getByRole("heading", { name: "Sala de Espera" });
    await expect(lobbyTitle).toBeVisible();

    // Verifica que os assentos são visíveis
    const seats = page.locator('[data-testid^="lobby-seat-"]');
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
    await page.locator('[data-testid="start-btn"]').click();

    // Aguarda transição para mesa
    await expect(page.locator('[data-testid="lobby-screen"]')).toBeHidden({
      timeout: 30000,
    });

    // Verifica que a mesa é utilizável em mobile
    const mesaScreen = page.locator('[data-testid="mesa-screen"]');
    await expect(mesaScreen).toBeVisible({ timeout: 10000 });

    // As cartas e os controles touch permanecem inteiros no viewport do device.
    const handCards = page.locator('[data-testid^="hand-card-"]');
    await expect(handCards.first()).toBeVisible({ timeout: 10000 });
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    if (!viewport) throw new Error("Mobile project must define a viewport");
    for (const card of await handCards.all()) {
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      if (!box) throw new Error("Visible card has no bounding box");
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }

    // Social panel (F5: emoji buttons live inside a bottom-sheet)
    const socialToggleBtn = page.getByTestId("social-toggle-btn");
    await expect(socialToggleBtn).toBeVisible();
    await socialToggleBtn.tap();
    const socialPanel = page.getByTestId("social-panel");
    await expect(socialPanel).toBeVisible({ timeout: 5000 });

    const emojiBtn = page.getByTestId("emoji-btn-👍");
    await expect(emojiBtn).toBeVisible({ timeout: 3000 });
    await emojiBtn.tap();
    // sendEmote closes the panel automatically in Mesa.tsx
    await expect(socialPanel).toBeHidden({ timeout: 5000 });
    await expect(page.getByTestId("emote-bubble-0")).toHaveText("👍");

    // Verifica que não há overflow horizontal (scroll horizontal)
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = viewport.width;
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 10); // Margem de 10px para arredondamento

    // Verifica que o placar é visível
    const scoreboard = page.locator('[data-testid="scoreboard"]');
    await expect(scoreboard).toBeVisible();
  });
});
