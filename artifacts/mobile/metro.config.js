// metro.config.js — Metro bundler configuration for MangaVerse on Replit.
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
  nodeModulesPaths: [
    path.resolve(projectRoot, "node_modules"),
    path.resolve(workspaceRoot, "node_modules"),
  ],
  disableHierarchicalLookup: false,
};

// ── Server: allow all hosts (Replit proxies requests from external domains) ──
config.server = {
  ...config.server,
  enhanceMiddleware: config.server?.enhanceMiddleware,
};

// ── Performance: cap workers for Replit containers (2 vCPUs) ─────────────
config.maxWorkers = Math.min(2, os.cpus().length);

// ── Reporter: suppress known-benign Replit noise ─────────────────────────
const originalReporter = config.reporter;
if (originalReporter && typeof originalReporter.update === "function") {
  const origUpdate = originalReporter.update.bind(originalReporter);
  config.reporter = {
    ...originalReporter,
    update(event) {
      if (
        event.type === "client_log" &&
        typeof event.data?.[0] === "string" &&
        (event.data[0].includes("libglib-2.0.so.0") ||
          event.data[0].includes("ECONNREFUSED") ||
          event.data[0].includes("debugger"))
      ) {
        return;
      }
      origUpdate(event);
    },
  };
}

module.exports = config;
