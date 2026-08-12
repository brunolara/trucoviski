import { describe, it, expect } from "vitest";
import {
  validateChat,
  validateEmote,
  validateThrowTomato,
  validateAction,
  EMOJI_WHITELIST,
} from "../packages/shared/src/index.js";
import type { SnapshotMessage } from "../packages/shared/src/index.js";

describe("Shared social validators (F4)", () => {
  describe("validateChat", () => {
    it("accepts valid chat texts", () => {
      expect(validateChat({ text: "Hello guys!" })).toEqual({
        text: "Hello guys!",
      });
      expect(validateChat({ text: "A".repeat(120) })).toEqual({
        text: "A".repeat(120),
      });
    });

    it("rejects invalid payloads", () => {
      expect(validateChat({ text: "A".repeat(121) })).toBeNull();
      expect(validateChat({ text: 123 })).toBeNull();
      expect(validateChat({ text: null })).toBeNull();
      expect(validateChat({})).toBeNull();
      expect(validateChat({ text: "Hello", extra: 123 })).toBeNull();
    });
  });

  describe("validateEmote", () => {
    it("accepts whitelisted emojis", () => {
      for (const emoji of EMOJI_WHITELIST) {
        expect(validateEmote({ emoji })).toEqual({ emoji });
      }
    });

    it("rejects non-whitelisted emojis and invalid types", () => {
      expect(validateEmote({ emoji: "🚀" })).toBeNull();
      expect(validateEmote({ emoji: "A" })).toBeNull();
      expect(validateEmote({ emoji: 123 })).toBeNull();
      expect(validateEmote({})).toBeNull();
    });
  });

  describe("validateThrowTomato", () => {
    it("accepts valid seat indexes", () => {
      expect(validateThrowTomato({ targetSeat: 0 })).toEqual({ targetSeat: 0 });
      expect(validateThrowTomato({ targetSeat: 3 })).toEqual({ targetSeat: 3 });
    });

    it("rejects invalid seat indexes", () => {
      expect(validateThrowTomato({ targetSeat: -1 })).toBeNull();
      expect(validateThrowTomato({ targetSeat: 4 })).toBeNull();
      expect(validateThrowTomato({ targetSeat: 1.5 })).toBeNull();
      expect(validateThrowTomato({})).toBeNull();
    });
  });
});

describe("F5: validateAction surrender", () => {
  it("accepts a valid surrender action", () => {
    expect(validateAction({ type: "surrender" })).toEqual({
      type: "surrender",
    });
  });

  it("rejects surrender with extra fields (strict)", () => {
    expect(validateAction({ type: "surrender", extra: 1 })).toBeNull();
  });

  it("rejects unknown action types", () => {
    expect(validateAction({ type: "quit" })).toBeNull();
  });
});

describe("F5: SnapshotMessage carries isOwner", () => {
  it("type allows an isOwner boolean field", () => {
    const snapshot: SnapshotMessage = {
      type: "snapshot",
      seat: 0,
      status: "waiting",
      connectedPlayers: 1,
      isOwner: true,
      metadata: {
        rulesetName: "paulista",
        rulesetVersion: "1.0.0",
        prngVersion: "1",
      },
    };
    expect(snapshot.isOwner).toBe(true);
  });
});
