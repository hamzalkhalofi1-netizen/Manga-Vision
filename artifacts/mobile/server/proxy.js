/**
 * Dev proxy — sits on the public webview port (default 5000) and routes:
 *   /api/* → API server on EXPO_API_PORT (default 3000)
 *   *      → Expo dev server on EXPO_DEV_PORT (default 5001)
 *
 * This lets the browser use relative URLs like /api/... for API calls
 * while also being able to serve the Expo web app from the same origin.
 * No npm dependencies required — uses Node.js built-in http and net modules.
 *
 * IMPORTANT: We override the `host` header when forwarding to Expo so Metro's
 * host-check middleware accepts the request (it only allows localhost by
 * default; the browser sends the Replit external domain as Host which Metro
 * would otherwise reject with a 400, causing an endless reconnect loop).
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
    // Override `host` so Metro's host-check accepts the proxied request.
    headers: { ...req.headers, host: `localhost:${targetPort}` },
  };

  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
    proxyRes.on("error", () => res.end());
  });

  proxy.on("error", () => {
    if (!res.headersSent) {
      if (targetPort === EXPO_PORT && req.method === "GET") {
        // Metro can take a few seconds to come up after the proxy starts.
        // Returning a one-shot 502 leaves the Replit preview iframe stuck on
        // a blank page, even after Metro becomes available. Keep the preview
        // alive with a small retry page instead.
        res.writeHead(503, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        });
        res.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MangaVerse</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; }
      body {
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #080808;
        color: #f5f5f5;
        font: 500 15px/1.5 system-ui, -apple-system, sans-serif;
      }
      main { text-align: center; padding: 32px; }
      .mark {
        width: 42px;
        height: 42px;
        margin: 0 auto 18px;
        border: 3px solid rgba(244, 63, 94, .25);
        border-top-color: #f43f5e;
        border-radius: 50%;
        animation: spin .8s linear infinite;
      }
      p { margin: 0; color: #a1a1aa; }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <main aria-live="polite">
      <div class="mark" aria-hidden="true"></div>
      <p>Starting MangaVerse…</p>
    </main>
    <script>setTimeout(function () { location.reload(); }, 1200);</script>
  </body>
</html>`);
        return;
      }
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

// Forward WebSocket upgrades (needed for Expo HMR / hot-reload).
// We rewrite the `host` header here too for the same Metro host-check reason.
server.on("upgrade", (req, socket, head) => {
  const isApi = req.url && req.url.startsWith("/api");
  const targetPort = isApi ? API_PORT : EXPO_PORT;

  const conn = net.connect(targetPort, "127.0.0.1");

  conn.on("error", (err) => {
    console.error(`[proxy] WS upstream error (port ${targetPort}):`, err.message);
    try { socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); } catch (_) {}
  });

  socket.on("error", () => { try { conn.destroy(); } catch (_) {} });
  conn.on("end", () => { try { socket.end(); } catch (_) {} });
  socket.on("end", () => { try { conn.end(); } catch (_) {} });

  conn.on("connect", () => {
    // Reconstruct the HTTP/1.1 upgrade request with the overridden host header.
    // Handle array header values (Node.js IncomingMessage can have these).
    let headerLines = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (const [k, v] of Object.entries(req.headers)) {
      if (k === "host") continue; // replaced below
      if (Array.isArray(v)) {
        for (const vi of v) headerLines += `${k}: ${vi}\r\n`;
      } else if (v != null) {
        headerLines += `${k}: ${v}\r\n`;
      }
    }
    headerLines += `host: localhost:${targetPort}\r\n`;
    headerLines += "\r\n";

    conn.write(headerLines);
    if (head && head.length > 0) conn.write(head);

    // Bidirectional pipe: upstream → browser, browser → upstream
    conn.pipe(socket);
    socket.pipe(conn);
  });
});

server.listen(PROXY_PORT, "0.0.0.0", () => {
  console.log(
    `[proxy] :${PROXY_PORT} → /api→:${API_PORT}, *→:${EXPO_PORT}`
  );
});
