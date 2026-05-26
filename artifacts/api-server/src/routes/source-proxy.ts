import { Router } from "express";
import type { Request, Response } from "express";

const router = Router();

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SOURCE_REGISTRY: Record<string, string> = {
  "comick-api": "https://api.comick.io",
  "comick-cdn": "https://meo.comick.pictures",
  "mangaplus": "https://api.mangaplus.shueisha.co.jp",
  "mangafire": "https://mangafire.to",
  "asura": "https://asuracomic.net",
  "naver": "https://www.webtoons.com",
};

const SOURCE_SITE_HEADERS: Record<string, { referer: string; origin: string }> = {
  "comick-api":  { referer: "https://comick.io/",                origin: "https://comick.io" },
  "comick-cdn":  { referer: "https://comick.io/",                origin: "https://comick.io" },
  "mangaplus":   { referer: "https://mangaplus.shueisha.co.jp/", origin: "https://mangaplus.shueisha.co.jp" },
  "mangafire":   { referer: "https://mangafire.to/",             origin: "https://mangafire.to" },
  "asura":       { referer: "https://asuracomic.net/",             origin: "https://asuracomic.net" },
  "naver":       { referer: "https://www.webtoons.com/",         origin: "https://www.webtoons.com" },
};

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

// Use regex routing so Express 5 wildcard captures work correctly.
// Matches /:sourceId  and  /:sourceId/any/path/here
router.get(/^\/([^/]+)(?:\/(.*))?$/, async (req: Request, res: Response) => {
  const params = req.params as unknown as string[];
  const sourceId = params[0] ?? "";
  const subpath = (params[1] ?? "").replace(/^\/+/, "");

  const baseUrl = SOURCE_REGISTRY[sourceId];
  if (!baseUrl) {
    res.status(400).json({
      error: `Unknown source: ${sourceId}. Allowed: ${Object.keys(SOURCE_REGISTRY).join(", ")}`,
    });
    return;
  }

  const qs = buildQueryString(req.query as Record<string, string | string[]>);
  const targetUrl = subpath ? `${baseUrl}/${subpath}${qs}` : `${baseUrl}${qs}`;

  const siteInfo = SOURCE_SITE_HEADERS[sourceId];
  const headers: Record<string, string> = {
    "User-Agent": BROWSER_UA,
    Accept: (req.headers["accept"] as string) || "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9",
    ...(siteInfo ? { Referer: siteInfo.referer, Origin: siteInfo.origin } : {}),
  };

  // Forward XHR header when present (needed for AJAX endpoints like MangaFire /home)
  const xrw = req.headers["x-requested-with"] as string | undefined;
  if (xrw) headers["X-Requested-With"] = xrw;

  const cfClearance = req.headers["x-cf-clearance"] as string | undefined;
  const extraCookie = req.headers["x-source-cookie"] as string | undefined;
  if (cfClearance || extraCookie) {
    const parts: string[] = [];
    if (cfClearance) parts.push(`cf_clearance=${cfClearance}`);
    if (extraCookie) parts.push(extraCookie);
    headers["Cookie"] = parts.join("; ");
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });

    const cfRay = upstream.headers.get("cf-ray");
    const isCfChallenge = cfRay !== null && (upstream.status === 403 || upstream.status === 503);
    if (isCfChallenge) {
      res.status(upstream.status).json({
        error: "cloudflare_challenge",
        message: "This source requires browser verification",
        sourceId,
      });
      return;
    }

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => "");
      if (body.includes("cloudflare_challenge") || body.includes("cf_clearance")) {
        res.status(403).json({ error: "cloudflare_challenge", sourceId });
        return;
      }
      res.status(upstream.status).json({ error: `Upstream ${upstream.status}` });
      return;
    }

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=120");
    res.setHeader("Access-Control-Allow-Origin", "*");
    const buffer = await upstream.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    req.log?.error({ err, targetUrl, sourceId }, "source-proxy error");
    res.status(502).json({ error: "Upstream request failed" });
  }
});

export default router;
