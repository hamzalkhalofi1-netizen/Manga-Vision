import { Router } from "express";

const router = Router();
const MANGADEX_API = "https://api.mangadex.org";
const MANGADEX_UPLOADS = "https://uploads.mangadex.org";

router.get("/uploads/*path", async (req, res) => {
  const targetUrl = `${MANGADEX_UPLOADS}/${req.params.path}${req.url.includes("?") ? `?${req.url.split("?")[1]}` : ""}`;
  try {
    const upstream = await fetch(targetUrl, {
      headers: { "User-Agent": "MangaVerse/1.0" },
    });
    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    const buffer = await upstream.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    req.log?.error({ err }, "Uploads proxy error");
    res.status(502).json({ error: "Upstream error" });
  }
});

router.get("/*path", async (req, res) => {
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const path = `/${req.params.path}`;
  const targetUrl = `${MANGADEX_API}${path}${qs}`;

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "MangaVerse/1.0",
      },
    });
    const data = await upstream.json();
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json(data);
  } catch (err) {
    req.log?.error({ err }, "MangaDex proxy error");
    res.status(502).json({ error: "Upstream error" });
  }
});

export default router;
