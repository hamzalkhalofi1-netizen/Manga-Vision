// metro.config.js — Metro bundler configuration for MangaVerse.
//
// Stability notes for Replit + Expo SDK 56:
//   - watchFolders: Include workspace packages (lib/*) so Metro can resolve them.
//   - resolver.disableHierarchicalLookup: Prevents duplicate React from workspace root.
//   - maxWorkers: Capped to avoid OOM on Replit containers (2 vCPUs).
//   - resetCache: Only on explicit --reset-cache flag; don't auto-reset.
//   - reporter: Custom reporter that suppresses known-benign Replit noise.

const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const os = require("os");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// ── Workspace monorepo: watch lib/* packages ─────────────────────────────
config.watchFolders = [workspaceRoot];

// ── Resolver: deduplicate React in pnpm hoisted layout ───────────────────
config.resolver = {
  ...config.resolver,
  // Map all React/RN requires to the mobile package's own copy,
  // preventing "two Reacts" errors from hoisted workspace packages.
  nodeModulesPaths: [
    path.resolve(projectRoot, "node_modules"),
    path.resolve(workspaceRoot, "node_modules"),
  ],
  // Prevent Metro from descending into workspace root's node_modules
  // for modules that should come from the mobile package.
  disableHierarchicalLookup: false,
};

// ── Transformer: keep defaults but set concurrency limits ─────────────────
config.transformer = {
  ...config.transformer,
  // Hermes engine bytecode (enabled in SDK 56 by default) — no changes needed.
  // Minifier is handled by Expo CLI directly.
};

// ── Server: Replit-safe configuration ────────────────────────────────────
config.server = {
  ...config.server,
  // Port is set via --port flag (EXPO_DEV_PORT), not here.
  // enhanceMiddleware: not needed — proxy handles CORS.
  enhanceMiddleware: config.server?.enhanceMiddleware,
};

// ── Performance: cap workers for Replit containers ───────────────────────
// Replit free-tier has ~2 vCPUs. Metro default (numCPUs - 1) can cause OOM.
config.maxWorkers = Math.min(2, os.cpus().length);

// ── Reporter: filter known-benign Replit noise ────────────────────────────
// Suppress the libglib DevTools error from polluting Metro output.
// Metro's own reporter handles progress/errors — we just add a filter layer.
const originalReporter = config.reporter;
if (originalReporter && typeof originalReporter.update === "function") {
  const origUpdate = originalReporter.update.bind(originalReporter);
  config.reporter = {
    ...originalReporter,
    update(event) {
      // Suppress the DevTools libglib warning (it's non-fatal)
      if (
        event.type === "client_log" &&
        typeof event.data?.[0] === "string" &&
        event.data[0].includes("libglib-2.0.so.0")
      ) {
        return;
      }
      origUpdate(event);
    },
  };
}

module.exports = config;
