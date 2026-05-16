import { Router } from "express";
import type { Request, Response } from "express";

const router = Router();
const MANGADEX_API = "https://api.mangadex.org";
const MANGADEX_UPLOADS = "https://uploads.mangadex.org";

function buildQueryString(query: Record<string, string | string[]>): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(query)) {
    if (Array.isArray(val)) {
      val.forEach((v) => parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
    }
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

router.get(/^\/uploads(\/.*)?$/, async (req: Request, res: Response) => {
  const pathAfterUploads = req.path.replace(/^\/uploads/, "") || "/";
  const targetUrl = `${MANGADEX_UPLOADS}/covers${pathAfterUploads}`;
  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MangaVerse/1.0)",
        "Referer": "https://mangadex.org/",
        "Origin": "https://mangadex.org",
      },
    });
    if (!upstream.ok) {
      res.status(upstream.status).end();
      return;
    }
    const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");
    const buffer = await upstream.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    req.log?.error({ err, targetUrl }, "Uploads proxy error");
    res.status(502).end();
  }
});

router.get(/^\/(.*)$/, async (req: Request, res: Response) => {
  const qs = buildQueryString(req.query as Record<string, string | string[]>);
  const targetUrl = `${MANGADEX_API}${req.path}${qs}`;

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
    req.log?.error({ err, targetUrl }, "MangaDex proxy error");
    res.status(502).json({ error: "Upstream error" });
  }
});

export default router;
