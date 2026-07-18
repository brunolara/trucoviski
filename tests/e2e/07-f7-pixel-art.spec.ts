/* ------------------------------------------------------------------ */
/*  Teste E2E: F7 — Tema Pixel Art (spritesheet único)                 */
/* ------------------------------------------------------------------ */
/*
 * O slice F7 trocou a renderização de cartas (texto/Unicode/CSS) por um
 * spritesheet pixel art. Não há seletor de tema: é o único tema.
 *
 * Este arquivo valida o MECANISMO de renderização via computed style dos
 * elementos <Carta> (divs com background-image do spritesheet), em vez de
 * depender de texto de rank/naipe, que deixou de existir no DOM.
 *
 * Também guarda anti-vazamento: cartas da mão são <div> sem texto, então
 * nenhum textual classifier de carta deve reaparecer no DOM.
 *
 * BLOQUEIO REPORTADO (não corrigido aqui): o componente Carta não expõe
 * data-* atributos de suit/rank nem data-testid para os elementos de vira
 * e cartas jogadas no centro da mesa. A vira e as cartas da vaza atual só
 * são acessíveis por traversal de DOM. O builder deve adicionar
 * data-testid="vira-carta" e data-testid="played-carta-{seat}" para
 * melhorar a testabilidade futura. (Ver bloqueio no relatório do tester.)
 */

import { test, expect, type Page } from "@playwright/test";

const FRONT_SPRITE = "card_fronts.png";
const BACK_SPRITE = "card_back_and_extras.png";

async function joinMesa(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Truco Paulista" }),
  ).toBeVisible({ timeout: 10000 });
  await page.locator('[data-testid="nickname-input"]').fill("Pixel");
  await page.locator('[data-testid="create-room-btn"]').click();
  await expect(page.locator('[data-testid="lobby-screen"]')).toBeVisible({
    timeout: 10000,
  });
  await page.locator('[data-testid="fill-bots-btn"]').click();
  await expect(page.locator('[data-testid="mesa-screen"]')).toBeVisible({
    timeout: 20000,
  });
}

test.describe("F7: Pixel Art spritesheet", () => {
  test("cartas da mão usam spritesheet de frente e não expõem texto de rank/naipe", async ({
    page,
  }) => {
    test.setTimeout(60000);

    await joinMesa(page);

    const handCards = page.locator('[data-testid^="hand-card-"]');
    await expect(handCards.first()).toBeVisible({ timeout: 10000 });
    await expect(handCards).toHaveCount(3);

    // Anti-vazamento: cartas são <div> sem conteúdo de texto (spritesheet).
    const texts = await handCards.allTextContents();
    for (const t of texts) {
      expect(t.trim()).toBe("");
    }

    // Cada carta da mão renderiza com o spritesheet de FRENTE.
    for (let i = 0; i < 3; i++) {
      const bg = await handCards
        .nth(i)
        .evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(bg, `carta ${i} deve usar ${FRONT_SPRITE}`).toContain(
        FRONT_SPRITE,
      );
    }
  });

  test("vira usa spritesheet de frente", async ({ page }) => {
    test.setTimeout(60000);

    await joinMesa(page);

    // A vira não tem data-testid próprio; navega pelo "Vira" label.
    // Mesa.tsx: <span className={styles.viraLabel}>Vira</span> + <motion.div className={styles.viraCard}><Carta card={view.vira} /></motion.div>
    // Ambos são filhos do mesmo viraWrapper.
    const viraBg = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll("span"));
      const viraSpan = spans.find((s) => s.textContent?.trim() === "Vira");
      // Pega o próximo elemento irmão (motion.div.viraCard) e dentro dele a Carta (div filho)
      const motionDiv = viraSpan?.parentElement?.querySelector(
        "div",
      ) as HTMLElement | null;
      const cartaDiv = motionDiv?.querySelector("div") as HTMLElement | null;
      return cartaDiv ? getComputedStyle(cartaDiv).backgroundImage : "";
    });

    expect(viraBg, "vira deve usar o spritesheet de frente").toContain(
      FRONT_SPRITE,
    );
  });

  test("cartas cobertas no histórico de vazas usam spritesheet de verso", async ({
    page,
  }) => {
    test.setTimeout(240000);

    await joinMesa(page);

    const handCards = page.locator('[data-testid^="hand-card-"]');
    await expect(handCards.first()).toBeVisible({ timeout: 10000 });

    let sawCoveredBack = false;
    let sawFrontInHistory = false;
    const maxIterations = 200;

    for (
      let it = 0;
      it < maxIterations && !(sawCoveredBack && sawFrontInHistory);
      it++
    ) {
      // Decide mão de onze se aparecer.
      const elevenPlay = page.getByTestId("eleven-play-btn");
      if (await elevenPlay.isVisible().catch(() => false)) {
        await elevenPlay.click({ force: true, timeout: 3000 }).catch(() => {});
      }

      // Responde truco se aparecer.
      const accept = page.getByTestId("truco-accept-btn");
      if (await accept.isVisible().catch(() => false)) {
        await accept.click({ force: true, timeout: 3000 }).catch(() => {});
      }

      // Se há botão de jogar coberta, usa-o para exercitar o VERSO.
      const coverBtn = page.locator('[data-testid^="cover-card-btn-"]').first();
      if (await coverBtn.isVisible().catch(() => false)) {
        await coverBtn.click({ force: true, timeout: 3000 }).catch(() => {});
      } else {
        // Joga carta visível (frente).
        const playCard = handCards.first();
        if (await playCard.isVisible().catch(() => false)) {
          await playCard
            .dblclick({ force: true, timeout: 3000 })
            .catch(() => {});
        }
      }

      await page.waitForTimeout(700);

      // Verifica mini-cartas no histórico de vazas (têm aria-label).
      // Cartas visíveis: aria-label = "{rank} de {naipe}"
      // Cartas cobertas: aria-label = "Carta coberta"
      const allMiniCards = await page.evaluate(() => {
        const results: Array<{ label: string; bg: string }> = [];
        // O aria-label é colocado pelo Mesa.tsx diretamente no div da Carta.
        const ariaEls = document.querySelectorAll(
          '[aria-label$="de ouros"],[aria-label$="de paus"],[aria-label$="de copas"],[aria-label$="de espadas"],[aria-label="Carta coberta"]',
        );
        for (const el of ariaEls) {
          const bg = getComputedStyle(el as HTMLElement).backgroundImage;
          results.push({
            label: (el as HTMLElement).getAttribute("aria-label") ?? "",
            bg,
          });
        }
        return results;
      });

      for (const { label, bg } of allMiniCards) {
        if (label === "Carta coberta" && bg.includes(BACK_SPRITE)) {
          sawCoveredBack = true;
        }
        if (label !== "Carta coberta" && bg.includes(FRONT_SPRITE)) {
          sawFrontInHistory = true;
        }
      }

      // Para quando a partida acabar.
      const endVisible = await page
        .getByTestId("end-screen")
        .isVisible({ timeout: 100 })
        .catch(() => false);
      if (endVisible) break;
    }

    // Deve ter visto pelo menos uma carta visível com frente no histórico.
    expect(
      sawFrontInHistory,
      "nenhuma carta do histórico usou o spritesheet de frente",
    ).toBe(true);

    // Deve ter visto pelo menos uma carta coberta com o spritesheet de verso.
    // Se não apareceu carta coberta durante o jogo, é um problema de testabilidade
    // mas não necessariamente um bug de produto — o teste continua correto.
    if (!sawCoveredBack) {
      console.warn(
        "AVISO: nenhuma carta coberta apareceu durante o jogo. " +
          "Adicione data-testid nos Carta cobertos para forçar verificação determinística.",
      );
    }
    // Esperamos sawCoveredBack=true pois o loop tenta usar cover-card-btn quando disponível.
    expect(
      sawCoveredBack,
      "carta coberta nunca usou card_back_and_extras.png — verifique cobertura do cover-card-btn",
    ).toBe(true);
  });
});
