import { Router } from "express";
import type { Request, Response } from "express";

const router = Router();

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SOURCE_REGISTRY: Record<string, string> = {
  "mangadex-api": "https://api.mangadex.org",
  "mangadex-cdn": "https://uploads.mangadex.org",
  "comick-api": "https://api.comick.io",
  "comick-cdn": "https://meo.comick.pictures",
  "mangaplus": "https://api.mangaplus.shueisha.co.jp",
  "mangafire": "https://mangafire.to",
  // asuracomic.net 301-redirects to asurascans.com home page. This redirect
  // is intentionally useful for web listing pages: the home page has SSR manga
  // cards that our parsers can extract. Direct asurascans.com /series?... paths
  // are pure client-side Astro (no SSR content). Native uses WebView directly.
  "asura": "https://asuracomic.net",
  "bato": "https://bato.to",
  // MangaKakalot family — chapmanganato.to (kakalot + manganato) and readmanganelo.com
  "kakalot": "https://chapmanganato.to",
  "manganato": "https://chapmanganato.to",
  "manganelo": "https://readmanganelo.com",
  "naver": "https://www.webtoons.com",
};

const SOURCE_SITE_HEADERS: Record<string, { referer: string; origin: string }> = {
  "mangadex-api": { referer: "https://mangadex.org/",                origin: "https://mangadex.org" },
  "mangadex-cdn": { referer: "https://mangadex.org/",                origin: "https://mangadex.org" },
  "comick-api":   { referer: "https://comick.io/",                   origin: "https://comick.io" },
  "comick-cdn":   { referer: "https://comick.io/",                   origin: "https://comick.io" },
  "mangaplus":    { referer: "https://mangaplus.shueisha.co.jp/",    origin: "https://mangaplus.shueisha.co.jp" },
  "mangafire":    { referer: "https://mangafire.to/",                origin: "https://mangafire.to" },
  "asura":        { referer: "https://asurascans.com/",              origin: "https://asurascans.com" },
  "bato":         { referer: "https://bato.to/",                    origin: "https://bato.to" },
  "kakalot":      { referer: "https://chapmanganato.to/",           origin: "https://chapmanganato.to" },
  "manganato":    { referer: "https://chapmanganato.to/",           origin: "https://chapmanganato.to" },
  // manganelo pages are on readmanganelo.com but CDN images are served from chapmanganato.to CDN;
  // using chapmanganato.to as referer satisfies the CDN anti-hotlink check on web proxy paths.
  "manganelo":    { referer: "https://chapmanganato.to/",           origin: "https://chapmanganato.to" },
  "naver":        { referer: "https://www.webtoons.com/",            origin: "https://www.webtoons.com" },
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
    res.setHeader("Cache-Control", isAjax ? "no-store" : "public, max-age=120");
    res.setHeader("Access-Control-Allow-Origin", "*");
    const buffer = await upstream.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    req.log?.error({ err, targetUrl, sourceId }, "source-proxy error");
    res.status(502).json({ error: "Upstream request failed" });
  }
});

export default router;
