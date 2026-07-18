import { test, expect } from "@playwright/test";

test.describe("Mesa Social & Juice Features (F4)", () => {
  test("allows player to send chat messages, emotes, throw tomatoes, and show cards", async ({
    page,
  }) => {
    // 1. Go to homepage
    await page.goto("/");
    await expect(page).toHaveTitle("Truco Paulista");

    // 2. Set nickname
    const nickInput = page.locator('[data-testid="nickname-input"]');
    await expect(nickInput).toBeVisible({ timeout: 5000 });
    await nickInput.fill("Jogador Testador");

    const createBtn = page.locator('[data-testid="create-room-btn"]');
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // 3. Lobby - Fill with bots to start game
    await expect(page.locator('[data-testid="lobby-screen"]')).toBeVisible({
      timeout: 15000,
    });
    const fillBotsBtn = page.locator('[data-testid="fill-bots-btn"]');
    await expect(fillBotsBtn).toBeVisible();
    await fillBotsBtn.click();

    // 4. Mesa - Verify mesa screen loaded
    await expect(page.locator('[data-testid="mesa-screen"]')).toBeVisible({
      timeout: 15000,
    });

    // 5. Test Chat Message
    const chatInput = page.getByTestId("chat-input");
    await expect(chatInput).toBeVisible();
    await chatInput.fill("Truco neles!");
    const chatSubmit = page.getByTestId("chat-submit-btn");
    await chatSubmit.click();

    // O broadcast voltou para o assento do emissor, não apenas para o input.
    await expect(page.getByTestId("chat-bubble-0")).toHaveText("Truco neles!");

    // 6. Test Emote
    const emojiBtn = page.getByTestId("emoji-btn-👍");
    await emojiBtn.click();

    // O emoji exibido é o resultado do evento recebido pelo servidor.
    await expect(page.getByTestId("emote-bubble-0")).toHaveText("👍");

    // 7. Test Tomato Throwing
    await page.getByTestId("tomato-btn-1").click();

    const tomatoEffect = page.getByTestId("tomato-effect");
    await expect(tomatoEffect).toBeVisible();

    // 8. Test Show Card (teasing)
    // A mão inicial tem três cartas; o valor mostrado deve ser a carta enviada.
    const firstCard = page.getByTestId("hand-card-0");
    const cardLabel = (await firstCard.textContent())?.trim();
    expect(cardLabel).toBeTruthy();
    if (!cardLabel) throw new Error("Initial private card is missing a label");
    await page.getByTestId("show-card-btn-0").click();
    const shownCard = page.getByTestId("shown-card-bubble-0");
    await expect(shownCard).toBeVisible();
    await expect(shownCard).toContainText("Mostrou:");
    await expect(shownCard).toContainText(cardLabel);
  });
});
