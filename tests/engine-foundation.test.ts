import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("engine foundation", () => {
  it("has no runtime dependencies", async () => {
    const packageJsonUrl = new URL(
      "../packages/engine/package.json",
      import.meta.url,
    );
    const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8")) as {
      dependencies?: unknown;
    };

    expect(packageJson).not.toHaveProperty("dependencies");
  });
});
