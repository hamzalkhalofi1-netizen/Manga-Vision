import { Router } from "express";
import type { Request, Response } from "express";

const router = Router();

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SOURCE_REGISTRY: Record<string, string> = {
  "mangadex-api": "https://api.mangadex.org",
  "mangadex-cdn": "https://uploads.mangadex.org",
  // ComicK migrated API from comick.io → comick.fun in 2024/2025
  "comick-api": "https://api.comick.fun",
  "comick-api-fallback": "https://api.comick.io",
  "comick-cdn": "https://meo.comick.pictures",
  "mangaplus": "https://api.mangaplus.shueisha.co.jp",
  "mangafire": "https://mangafire.to",
  // CDN for chapter page images — separate from the main site so the proxy
  // can send Referer: https://mangafire.to/ (required to bypass hotlink protection)
  "mangafire-cdn": "https://cdn.mangafire.to",
  // asurascans.com is the live domain (asuracomic.net 301-redirects here)
  "asura": "https://asurascans.com",
  // First-party JSON REST API — separate subdomain, needs its own proxy entry so
  // the server can add the correct Origin / Referer headers for CORS compliance.
  "asura-api": "https://api.asurascans.com",
  // CDN for chapter page images — separate subdomain, proxy adds Referer to bypass
  // Cloudflare's hotlink-protection rules.
  "asura-cdn": "https://cdn.asurascans.com",
  "bato": "https://bato.to",
  // MangaKakalot / Manganato family — migrated to natomanga.com (same HTML structure)
  // chapmanganato.to, readmanganelo.com, manganato.com are all dead/squatted (as of 2026).
  // The "manganelo" source adapter targets mangagg.com (WordPress/Madara theme).
  "kakalot": "https://www.natomanga.com",
  "manganato": "https://www.natomanga.com",
  // natomanga CDN — chapter images live on img-r1.2xstorage.com (primary) / imgs-2.2xstorage.com (fallback)
  "natomanga-cdn":  "https://img-r1.2xstorage.com",
  "natomanga-cdn2": "https://imgs-2.2xstorage.com",
  // mangagg.com — live WP-Manga site replacing the defunct Manganelo/Kakalot family
  "mangagg": "https://mangagg.com",
  // CDN for chapter page images (hosted on s4.mangagg.com)
  "mangagg-cdn": "https://s4.mangagg.com",
  // Naver Webtoon / WEBTOON
  "naver": "https://www.webtoons.com",
  "webtoon": "https://www.webtoons.com",
};

const SOURCE_SITE_HEADERS: Record<string, { referer: string; origin: string }> = {
  "mangadex-api": { referer: "https://mangadex.org/",                origin: "https://mangadex.org" },
  "mangadex-cdn": { referer: "https://mangadex.org/",                origin: "https://mangadex.org" },
  "comick-api":         { referer: "https://comick.io/",             origin: "https://comick.io" },
  "comick-api-fallback":{ referer: "https://comick.io/",             origin: "https://comick.io" },
  "comick-cdn":         { referer: "https://comick.io/",             origin: "https://comick.io" },
  "mangaplus":    { referer: "https://mangaplus.shueisha.co.jp/",    origin: "https://mangaplus.shueisha.co.jp" },
  "mangafire":    { referer: "https://mangafire.to/",                origin: "https://mangafire.to" },
  "mangafire-cdn":{ referer: "https://mangafire.to/",               origin: "https://mangafire.to" },
  "asura":        { referer: "https://asurascans.com/",              origin: "https://asurascans.com" },
  "asura-api":    { referer: "https://asurascans.com/",              origin: "https://asurascans.com" },
  "asura-cdn":    { referer: "https://asurascans.com/",              origin: "https://asurascans.com" },
  "bato":         { referer: "https://bato.to/",                    origin: "https://bato.to" },
  "kakalot":      { referer: "https://www.natomanga.com/",          origin: "https://www.natomanga.com" },
  "manganato":    { referer: "https://www.natomanga.com/",          origin: "https://www.natomanga.com" },
  "natomanga-cdn": { referer: "https://www.natomanga.com/",          origin: "https://www.natomanga.com" },
  "natomanga-cdn2":{ referer: "https://www.natomanga.com/",          origin: "https://www.natomanga.com" },
  // mangagg.com — WP-Manga/Madara site; chapter images on s4.mangagg.com need
  // the main site as Referer to satisfy hotlink-protection rules.
  "mangagg":      { referer: "https://mangagg.com/",                origin: "https://mangagg.com" },
  "mangagg-cdn":  { referer: "https://mangagg.com/",                origin: "https://mangagg.com" },
  "naver":              { referer: "https://www.webtoons.com/",      origin: "https://www.webtoons.com" },
  "webtoon":            { referer: "https://www.webtoons.com/",      origin: "https://www.webtoons.com" },
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

  // Forward the raw query string directly to avoid Express's qs parser mangling
  // bracket-notation keys like `includes[]=cover_art` → `includes=cover_art`.
  // MangaDex and many other APIs require literal `[` `]` in query params.
  const rawSearch = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const targetUrl = subpath ? `${baseUrl}/${subpath}${rawSearch}` : `${baseUrl}${rawSearch}`;

  const siteInfo = SOURCE_SITE_HEADERS[sourceId];

  // Allow callers to override the Referer (needed for MangaFire chapter image AJAX
  // which requires Referer = the actual reader page URL, not the site root)
  const refererOverride = req.headers["x-proxy-referer"] as string | undefined;

  const headers: Record<string, string> = {
    "User-Agent": BROWSER_UA,
    Accept: (req.headers["accept"] as string) || "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9",
    ...(siteInfo ? { Referer: refererOverride ?? siteInfo.referer, Origin: siteInfo.origin } : {}),
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
    // Disable caching for AJAX endpoints (e.g. /ajax/read/{token}/chapter/en)
    // whose response depends on the Referer header.  Caching a 403 response
    // would permanently block chapter image loading until the browser cache expires.
    const isAjax = subpath.startsWith("ajax/") || refererOverride;
    // Scraped HTML/JSON is freshness-sensitive: chapter pages embed time-limited
    // signed CDN URLs and adapters re-parse the *whole* body on every fetch —
    // there is no partial-update path. If a client's HTTP cache (browser disk
    // cache, RN networking layer) revisits this exact URL and Express's own
    // res.send() auto-ETag freshness check matches, it silently downgrades the
    // response to an EMPTY 304 body, which zeroes out page/image extraction
    // with no error surfaced. Binary CDN images are exempt: their URLs already
    // carry a cache-busting token, so conditional caching there is safe and
    // saves bandwidth.
    const isScrapedContent = contentType.includes("text/html") || contentType.includes("application/json");
    if (isAjax || isScrapedContent) {
      res.setHeader("Cache-Control", "no-store");
      // Strip incoming conditional-GET headers so Express's built-in ETag
      // freshness check (inside res.send()) can never convert this response
      // into a bare 304 with a stripped body.
      delete req.headers["if-none-match"];
      delete req.headers["if-modified-since"];
    } else {
      res.setHeader("Cache-Control", "public, max-age=120");
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    const buffer = await upstream.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    req.log?.error({ err, targetUrl, sourceId }, "source-proxy error");
    res.status(502).json({ error: "Upstream request failed" });
  }
});

export default router;
