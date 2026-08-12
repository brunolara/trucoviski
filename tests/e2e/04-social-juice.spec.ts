import { test, expect } from "@playwright/test";

test.describe("Mesa Social & Juice Features (F4/F5)", () => {
  test("allows player to send chat messages, emotes, and throw tomatoes via the social panel", async ({
    page,
  }) => {
    // 1. Go to homepage
    await page.goto("/");
    await expect(page).toHaveTitle("Truco Paulista");

    // 2. Set nickname
    const nickInput = page.locator('[data-testid="nickname-input"]');
    await expect(nickInput).toBeVisible({ timeout: 5000 });
    nickInput.fill("Jogador Testador");

    const createBtn = page.locator('[data-testid="create-room-btn"]');
    await expect(createBtn).toBeVisible();
    createBtn.click();

    // 3. Lobby - Fill with bots to start game
    await expect(page.locator('[data-testid="lobby-screen"]')).toBeVisible({
      timeout: 15000,
    });
    const fillBotsBtn = page.locator('[data-testid="fill-bots-btn"]');
    await expect(fillBotsBtn).toBeVisible();
    await fillBotsBtn.click();
    await page.locator('[data-testid="start-btn"]').click();

    // 4. Mesa - Verify mesa screen loaded
    await expect(page.locator('[data-testid="mesa-screen"]')).toBeVisible({
      timeout: 15000,
    });

    // 5. Open the social panel (UI social moved behind a bottom-sheet in F5).
    const socialToggle = page.getByTestId("social-toggle-btn");
    await expect(socialToggle).toBeVisible();
    socialToggle.click();
    const socialPanel = page.getByTestId("social-panel");
    await expect(socialPanel).toBeVisible();

    // 6. Test Chat Message (only available with the panel open)
    const chatInput = page.getByTestId("chat-input");
    await expect(chatInput).toBeVisible();
    await chatInput.fill("Truco neles!");
    const chatSubmit = page.getByTestId("chat-submit-btn");
    await chatSubmit.click();

    // O broadcast voltou para o assento do emissor, não apenas para o input.
    await expect(page.getByTestId("chat-bubble-0")).toHaveText("Truco neles!");

    // 7. Test Emote (re-open panel if needed)
    if (!(await socialPanel.isVisible())) {
      socialToggle.click();
      await expect(socialPanel).toBeVisible();
    }
    const emojiBtn = page.getByTestId("emoji-btn-👍");
    await emojiBtn.click();

    // O emoji exibido é o resultado do evento recebido pelo servidor.
    await expect(page.getByTestId("emote-bubble-0")).toHaveText("👍");

    // 8. Test social-close-btn: open panel and close explicitly
    await socialToggle.click();
    await expect(socialPanel).toBeVisible();
    const socialClose = page.getByTestId("social-close-btn");
    await expect(socialClose).toBeVisible();
    await socialClose.click();
    await expect(page.getByTestId("social-panel")).toBeHidden();

    // 9. Test Tomato Throwing (works independently of the social panel)
    await page.getByTestId("tomato-btn-1").click();

    const tomatoEffect = page.getByTestId("tomato-effect");
    await expect(tomatoEffect).toBeVisible();
  });
});
