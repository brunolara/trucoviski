import { describe, it, expect } from "vitest";
import {
  decideHeuristicV3Action,
  V3_FEATURES,
  assessHand,
  distanceCovers,
} from "../packages/bots/src/heuristic2.js";
import type { HeuristicV2Features } from "../packages/bots/src/heuristic2.js";
import type { PlayerView, Card } from "@trucoviski/engine";

describe("Heuristic Bot v3", () => {
  const defaultVira: Card = { suit: "paus", rank: "4" }; // manilha is '5'
  const midRng = () => 0.5;

  const baseView: PlayerView = {
    handNumber: 1,
    mySeat: 0,
    dealerSeat: 0,
    handCards: [],
    vira: defaultVira,
    completedVazas: [],
    currentVaza: null,
    scores: [0, 0],
    trucoValue: 1,
    trucoPendingTeam: null,
    trucoPendingValue: null,
    trucoRaises: [],
    isElevenHand: false,
    isFerro: false,
    elevenDecision: null,
    legalActions: [],
  };

  function withFlags(
    overrides: Partial<HeuristicV2Features>,
  ): HeuristicV2Features {
    return {
      ...V3_FEATURES,
      // isolate: only the flag under test (+ knobs), rest of v3 flags off
      elevenNeedsPair: false,
      positionAware: false,
      raiseGuard: false,
      distanceToTwelve: false,
      softOverrides: false,
      topTwoStrength: false,
      useEvTruco: false,
      ...overrides,
    };
  }

  describe("handAssessment", () => {
    it("reports beatsTable and isLastToPlay", () => {
      const view: PlayerView = {
        ...baseView,
        mySeat: 0,
        handCards: [{ suit: "paus", rank: "5" }], // zap
        currentVaza: {
          plays: [
            null,
            { suit: "copas", rank: "Q" },
            { suit: "ouros", rank: "K" },
            { suit: "espadas", rank: "A" },
          ],
          covered: [false, false, false, false],
          currentSeat: 0,
        },
        legalActions: [{ type: "playCard", card: { suit: "paus", rank: "5" } }],
      };
      const a = assessHand(view);
      expect(a.cardsPlayedInVaza).toBe(3);
      expect(a.isLastToPlay).toBe(true);
      expect(a.beatsTable).toBe(true);
      expect(a.myMax).toBe(13);
      expect(a.topTwo).toBeGreaterThan(0.5);
    });
  });

  describe("elevenNeedsPair", () => {
    it("runs when only one player has a 3 (teamMax>=9) — no real pair", () => {
      const view: PlayerView = {
        ...baseView,
        isElevenHand: true,
        handCards: [{ suit: "copas", rank: "3" }],
        partnerCards: [{ suit: "ouros", rank: "4" }],
        legalActions: [
          { type: "elevenDecision", decision: "play" },
          { type: "elevenDecision", decision: "run" },
        ],
      };
      const on = decideHeuristicV3Action(
        view,
        midRng,
        withFlags({ elevenNeedsPair: true, elevenPairFloor: 8 }),
      );
      const off = decideHeuristicV3Action(
        view,
        midRng,
        withFlags({ elevenNeedsPair: false }),
      );
      expect(on).not.toEqual(off);
      expect(on).toEqual({ type: "elevenDecision", decision: "run" });
    });
  });

  describe("raiseGuard", () => {
    it("does not auto-raise to 12 with only zap when facing a 9", () => {
      const view: PlayerView = {
        ...baseView,
        scores: [5, 5],
        trucoPendingTeam: 1,
        trucoPendingValue: 9,
        handCards: [
          { suit: "paus", rank: "5" },
          { suit: "ouros", rank: "4" },
          { suit: "espadas", rank: "4" },
        ],
        legalActions: [
          { type: "truco", action: "accept" },
          { type: "truco", action: "run" },
          { type: "truco", action: "raise" },
        ],
      };
      const on = decideHeuristicV3Action(
        view,
        midRng,
        withFlags({ raiseGuard: true, raiseGuardMaxLevel: 9 }),
      );
      const off = decideHeuristicV3Action(
        view,
        midRng,
        withFlags({ raiseGuard: false }),
      );
      expect(on).not.toEqual(off);
      expect((on as { action: string }).action).not.toBe("raise");
      expect(off).toEqual({ type: "truco", action: "raise" });
    });
  });

  describe("softOverrides", () => {
    it("does not unconditionally accept a 12 just because it won the first vaza", () => {
      const view: PlayerView = {
        ...baseView,
        scores: [8, 10],
        trucoPendingTeam: 1,
        trucoPendingValue: 12,
        completedVazas: [
          {
            plays: [
              { suit: "ouros", rank: "3" },
              { suit: "copas", rank: "4" },
              { suit: "espadas", rank: "6" },
              { suit: "paus", rank: "7" },
            ],
            covered: [false, false, false, false],
            winner: 0,
            tiedSeats: [],
          },
        ],
        handCards: [
          { suit: "ouros", rank: "4" },
          { suit: "espadas", rank: "4" },
        ],
        legalActions: [
          { type: "truco", action: "accept" },
          { type: "truco", action: "run" },
        ],
      };
      const on = decideHeuristicV3Action(
        view,
        midRng,
        withFlags({
          softOverrides: true,
          softWonFirstBonus: 0.1,
          topAliveAccept: false,
        }),
      );
      const off = decideHeuristicV3Action(
        view,
        midRng,
        withFlags({
          softOverrides: false,
          wonFirstVazaMode: "override",
          topAliveAccept: false,
        }),
      );
      expect(on).not.toEqual(off);
      expect(on).toEqual({ type: "truco", action: "run" });
      expect(off).toEqual({ type: "truco", action: "accept" });
    });
  });

  describe("positionAware (F5.2)", () => {
    it("flag changes decision when last to play and beats the table", () => {
      const view: PlayerView = {
        ...baseView,
        mySeat: 0,
        trucoPendingTeam: 1,
        trucoPendingValue: 3,
        handCards: [{ suit: "espadas", rank: "A" }],
        currentVaza: {
          plays: [
            null,
            { suit: "copas", rank: "Q" },
            { suit: "ouros", rank: "J" },
            { suit: "paus", rank: "K" },
          ],
          covered: [false, false, false, false],
          currentSeat: 0,
        },
        legalActions: [
          { type: "truco", action: "accept" },
          { type: "truco", action: "run" },
        ],
      };
      const common = {
        responseBaseOffset: 3,
        topAliveAccept: false,
        wonFirstVazaMode: "none" as const,
        positionBeatsBonus: 0.2,
        positionInfoBonus: 0.1,
      };
      const on = decideHeuristicV3Action(
        view,
        midRng,
        withFlags({ positionAware: true, ...common }),
      );
      const off = decideHeuristicV3Action(
        view,
        midRng,
        withFlags({ positionAware: false, ...common }),
      );
      expect(on).not.toEqual(off);
      expect(on).toEqual({ type: "truco", action: "accept" });
    });
  });

  describe("distanceToTwelve (F5.1)", () => {
    it("sanity table: covers match expected fractions", () => {
      expect(distanceCovers(3, 12, 12)).toEqual({
        coverLose: 0.25,
        coverWin: 0.25,
      });
      expect(distanceCovers(3, 12, 2)).toEqual({
        coverLose: 0.25,
        coverWin: 1,
      }); // 10×0 → distWin=2
      expect(distanceCovers(3, 2, 12)).toEqual({
        coverLose: 1,
        coverWin: 0.25,
      }); // 0×10
      expect(distanceCovers(3, 3, 3)).toEqual({ coverLose: 1, coverWin: 1 }); // 9×9
      expect(distanceCovers(12, 12, 12)).toEqual({
        coverLose: 1,
        coverWin: 1,
      });
    });

    it("flag changes decision at atRisk=12 where v2 binaries cancel (buraco #4)", () => {
      // placar 0×0, atRisk=12: binários v2 se anulam (+0.12−0.12);
      // magnitude + runCost (prev=9 → 9/12) diferencia.
      // Mão mediana (A=7): limiar off fica acima → run; on com runCost → accept.
      const view: PlayerView = {
        ...baseView,
        scores: [0, 0],
        trucoPendingTeam: 1,
        trucoPendingValue: 12,
        handCards: [
          { suit: "espadas", rank: "A" },
          { suit: "ouros", rank: "K" },
        ],
        legalActions: [
          { type: "truco", action: "accept" },
          { type: "truco", action: "run" },
        ],
      };
      const common = {
        topAliveAccept: false,
        wonFirstVazaMode: "none" as const,
        responseBaseOffset: 1,
        distDangerWeight: 0.1,
        distFinishWeight: 0.1,
        runCostWeight: 0.25,
      };
      const on = decideHeuristicV3Action(
        view,
        midRng,
        withFlags({ distanceToTwelve: true, ...common }),
      );
      const off = decideHeuristicV3Action(
        view,
        midRng,
        withFlags({ distanceToTwelve: false, ...common }),
      );
      expect(on).not.toEqual(off);
      expect(on).toEqual({ type: "truco", action: "accept" });
      expect(off).toEqual({ type: "truco", action: "run" });
    });
  });

  describe("topTwoStrength", () => {
    it("treats [zap,3,3] stronger than [zap,4,4] via handStrength", () => {
      const zapView: PlayerView = {
        ...baseView,
        trucoPendingTeam: 1,
        trucoPendingValue: 6,
        handCards: [
          { suit: "paus", rank: "5" },
          { suit: "copas", rank: "3" },
          { suit: "espadas", rank: "3" },
        ],
        legalActions: [
          { type: "truco", action: "accept" },
          { type: "truco", action: "run" },
        ],
      };
      const weakKickers: PlayerView = {
        ...zapView,
        handCards: [
          { suit: "paus", rank: "5" },
          { suit: "copas", rank: "4" },
          { suit: "espadas", rank: "4" },
        ],
      };
      const feats = withFlags({
        topTwoStrength: true,
        topAliveAccept: false,
        wonFirstVazaMode: "none",
        responseBaseOffset: 5,
      });
      const aStrong = assessHand(zapView);
      const aWeak = assessHand(weakKickers);
      expect(aStrong.topTwo).toBeGreaterThan(aWeak.topTwo);
      expect(aStrong.myMax).toBe(aWeak.myMax);

      const actStrong = decideHeuristicV3Action(zapView, midRng, feats);
      expect(actStrong).toEqual({ type: "truco", action: "accept" });
    });
  });

  describe("F5.3 softWonFirst only on respond", () => {
    it("propose after wonFirst is not double-discounted into always-raise", () => {
      const view: PlayerView = {
        ...baseView,
        scores: [3, 3],
        trucoValue: 1,
        completedVazas: [
          {
            plays: [
              { suit: "ouros", rank: "3" },
              { suit: "copas", rank: "4" },
              { suit: "espadas", rank: "6" },
              { suit: "paus", rank: "7" },
            ],
            covered: [false, false, false, false],
            winner: 0,
            tiedSeats: [],
          },
        ],
        handCards: [
          { suit: "ouros", rank: "4" },
          { suit: "espadas", rank: "4" },
        ],
        legalActions: [
          { type: "truco", action: "raise" },
          { type: "playCard", card: { suit: "ouros", rank: "4" } },
          { type: "playCard", card: { suit: "espadas", rank: "4" } },
        ],
      };
      // Com softOverrides + softWonFirst no propose (bug antigo), limiar cai demais
      // e pede truco com lixo. Depois do F5.3, não deve pedir.
      const action = decideHeuristicV3Action(
        view,
        midRng,
        withFlags({
          softOverrides: true,
          softWonFirstBonus: 0.35,
          softTopAliveBonus: 0,
          topAliveAccept: false,
          proposeBaseOffset: 2,
          wonFirstVazaMode: "override",
        }),
      );
      expect(action?.type).not.toBe("truco");
    });
  });
});
