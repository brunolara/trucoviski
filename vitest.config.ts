import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@trucoviski/engine": new URL(
        "./packages/engine/src/index.ts",
        import.meta.url,
      ).pathname,
      "@trucoviski/shared": new URL(
        "./packages/shared/src/index.ts",
        import.meta.url,
      ).pathname,
      "@trucoviski/server": new URL(
        "./apps/server/src/index.ts",
        import.meta.url,
      ).pathname,
      "@colyseus/sdk": new URL(
        "./apps/web/node_modules/@colyseus/sdk",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    fileParallelism: false,
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["packages/engine/src/**/*.ts"],
      exclude: [
        "packages/engine/src/index.ts",
        "packages/engine/src/simulation.ts",
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 92,
        statements: 95,
      },
    },
    include: ["tests/**/*.test.ts"],
  },
});
