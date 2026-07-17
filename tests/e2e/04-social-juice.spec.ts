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
    const chatInput = page.locator('input[placeholder="Digite provocação..."]');
    await expect(chatInput).toBeVisible();
    await chatInput.fill("Truco neles!");
    const chatSubmit = page.locator('button[type="submit"]');
    await chatSubmit.click();

    // Verify chat bubble is visible on player's seat (relative seat 0)
    await expect(page.locator("text=Truco neles!")).toBeVisible();

    // 6. Test Emote
    const emojiBtn = page.locator("text=👍");
    await emojiBtn.click();

    // Verify emoji bubble is visible
    await expect(page.locator("text=👍")).toBeVisible();

    // 7. Test Tomato Throwing
    // Locate tomato throw button on one of the other players (seat 1, 2, or 3)
    const tomatoBtns = page.locator('button[title^="Jogar tomate em"]');
    const count = await tomatoBtns.count();
    expect(count).toBeGreaterThan(0);
    await tomatoBtns.first().click();

    // Verify active tomato element or splat element appears
    const tomatoEffect = page.locator(`div[class*="tomatoEffect"]`);
    await expect(tomatoEffect).toBeVisible();

    // 8. Test Show Card (teasing)
    // Reveal button (eye icon) is present for cards in hand
    const revealBtns = page.locator(
      'button[title="Mostrar/provocar oponente com esta carta"]',
    );
    const cardsCount = await revealBtns.count();
    if (cardsCount > 0) {
      await revealBtns.first().click();
      // Verify shown card bubble is visible
      await expect(page.locator("text=Mostrou:")).toBeVisible();
    }
  });
});
