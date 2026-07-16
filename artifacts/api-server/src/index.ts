import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Bind explicitly to 0.0.0.0 (IPv4, all interfaces). Without a host argument,
// Node defaults to the IPv6 unspecified address, which some container network
// namespaces don't dual-stack correctly for external IPv4 probes — causing a
// working server to look "unreachable" to the platform's port-readiness check.
app.listen(port, "0.0.0.0", (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
