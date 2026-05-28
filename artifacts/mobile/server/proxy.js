/**
 * Dev proxy — sits on the public webview port (default 5000) and routes:
 *   /api/* → API server on EXPO_API_PORT (default 3000)
 *   *      → Expo dev server on EXPO_DEV_PORT (default 5001)
 *
 * This lets the browser use relative URLs like /api/... for API calls
 * while also being able to serve the Expo web app from the same origin.
 * No npm dependencies required — uses Node.js built-in http and net modules.
 */

const http = require("http");
const net = require("net");

const PROXY_PORT = parseInt(process.env.PORT || "5000", 10);
const EXPO_PORT = parseInt(process.env.EXPO_DEV_PORT || "5001", 10);
const API_PORT = parseInt(process.env.EXPO_API_PORT || "3000", 10);

function forward(req, res, targetPort) {
  const options = {
    hostname: "127.0.0.1",
    port: targetPort,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };

  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
    proxyRes.on("error", () => res.end());
  });

  proxy.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
    }
    res.end(`upstream error (port ${targetPort})`);
  });

  req.pipe(proxy, { end: true });
  req.on("error", () => proxy.destroy());
}

const server = http.createServer((req, res) => {
  const isApi = req.url && req.url.startsWith("/api");
  forward(req, res, isApi ? API_PORT : EXPO_PORT);
});

// Forward WebSocket upgrades (needed for Expo HMR / hot-reload)
server.on("upgrade", (req, socket, head) => {
  const isApi = req.url && req.url.startsWith("/api");
  const targetPort = isApi ? API_PORT : EXPO_PORT;

  const conn = net.connect(targetPort, "127.0.0.1", () => {
    const headers = [
      `${req.method} ${req.url} HTTP/${req.httpVersion}`,
      ...Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`),
      "",
      "",
    ].join("\r\n");

    conn.write(headers);
    if (head && head.length > 0) conn.write(head);
    conn.pipe(socket).pipe(conn);
  });

  conn.on("error", () => socket.destroy());
  socket.on("error", () => conn.destroy());
});

server.listen(PROXY_PORT, "0.0.0.0", () => {
  console.log(
    `[proxy] :${PROXY_PORT} → /api→:${API_PORT}, *→:${EXPO_PORT}`
  );
});
