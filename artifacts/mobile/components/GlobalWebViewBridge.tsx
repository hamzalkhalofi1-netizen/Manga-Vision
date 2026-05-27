/**
 * GlobalWebViewBridge
 *
 * Mounted ONCE in _layout.tsx. Owns one persistent hidden WebView per
 * CF-protected source (mangafire, asura). Source adapters request HTML/JSON
 * through webViewBridge.fetch() / fetchRendered(); this component fulfills
 * every request by injecting fetch() scripts into the appropriate WebView.
 *
 * Key differences from the old popup model:
 *  - WebViews are ALWAYS mounted — they accumulate cf_clearance across sessions.
 *  - Verification is triggered only when CF is actually blocking (rare after
 *    first solve). The same persistent WebView is revealed inline.
 *  - All pending requests are automatically retried after CF is solved.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Platform, StyleSheet, View } from "react-native";
import WebView from "react-native-webview";
import { sessionStore } from "@/services/sessionStore";
import {
  BridgeRequest,
  BridgeSourceStatus,
  webViewBridge,
} from "@/services/webViewBridge";

// ── Bridge source registry ────────────────────────────────────────────────

const BRIDGE_SOURCES = [
  { id: "mangafire", baseUrl: "https://mangafire.to" },
  // asuracomic.net 301-redirects to asurascans.com as of 2025/2026.
  // Use the live domain directly so the WebView doesn't start with a redirect.
  { id: "asura", baseUrl: "https://asurascans.com" },
] as const;

// ── React context ─────────────────────────────────────────────────────────

export interface BridgeContextValue {
  statuses: Partial<Record<string, BridgeSourceStatus>>;
  showVerification: (sourceId: string) => void;
  hideVerification: () => void;
}

export const BridgeContext = createContext<BridgeContextValue>({
  statuses: {},
  showVerification: () => {},
  hideVerification: () => {},
});

export function useBridgeStatus(sourceId: string): BridgeSourceStatus {
  const { statuses } = useContext(BridgeContext);
  return statuses[sourceId] ?? "initializing";
}

// ── JS injected on every page load (CF detector + cookie reporter) ────────

const SESSION_JS = `(function(){
  function report(){
    try{
      var isCF=/just a moment|checking your browser|cloudflare/i.test(document.title)||
        !!document.querySelector('#cf-browser-verification,#challenge-form,#challenge-running,.cf-browser-verification,.hcaptcha-box,[data-translate="checking_browser"]');
      window.ReactNativeWebView.postMessage(JSON.stringify({
        __session:true,isCF:isCF,
        hasCFClearance:document.cookie.indexOf('cf_clearance')>=0,
        cookies:document.cookie,title:document.title
      }));
    }catch(e){}
  }
  report();
  var iv=setInterval(report,1500);
  window.addEventListener('unload',function(){clearInterval(iv);});
  true;
})();`;

// ── Per-request JS builders ───────────────────────────────────────────────

function buildFetchScript(req: BridgeRequest): string {
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    const kl = k.toLowerCase();
    if (!["cookie", "referer", "origin", "host", "content-length"].includes(kl)) {
      safe[k] = v;
    }
  }
  const id = JSON.stringify(req.id);
  const url = JSON.stringify(req.url);
  const method = JSON.stringify(req.method ?? "GET");
  const headers = JSON.stringify(safe);
  return `(async function(){try{var r=await fetch(${url},{method:${method},credentials:'include',headers:${headers}});var b=await r.text();window.ReactNativeWebView.postMessage(JSON.stringify({__bridge:true,id:${id},ok:r.ok,status:r.status,body:b}));}catch(e){window.ReactNativeWebView.postMessage(JSON.stringify({__bridge:true,id:${id},ok:false,status:0,error:String(e)}));}})();true;`;
}

function buildRenderScript(req: BridgeRequest): string {
  const id = JSON.stringify(req.id);
  const wait = req.renderWaitMs ?? 2500;
  return `(async function(){await new Promise(function(r){setTimeout(r,${wait});});try{var h=document.documentElement.outerHTML;window.ReactNativeWebView.postMessage(JSON.stringify({__bridge:true,id:${id},ok:true,status:200,body:h}));}catch(e){window.ReactNativeWebView.postMessage(JSON.stringify({__bridge:true,id:${id},ok:false,status:0,error:String(e)}));}})();true;`;
}

// ── Mutable per-source state (ref) ────────────────────────────────────────

interface SourceMutable {
  queue: BridgeRequest[];
  processing: boolean;
  ready: boolean;
  cfChallenge: boolean;
  currentReq: BridgeRequest | null;
  wasRendered: boolean;     // true when currentReq was extractRendered
  baseUrl: string;
  currentUri: string;       // tracks the URI we last navigated to
  webViewRef: React.RefObject<WebView | null>;
}

// ── Component ─────────────────────────────────────────────────────────────

export default function GlobalWebViewBridge({
  children,
}: {
  children: React.ReactNode;
}) {
  // React state for things that drive rendering (status, visibility, URI)
  const [statuses, setStatuses] = useState<Partial<Record<string, BridgeSourceStatus>>>(
    () => Object.fromEntries(BRIDGE_SOURCES.map((s) => [s.id, "initializing" as BridgeSourceStatus]))
  );
  const [visibleSource, setVisibleSource] = useState<string | null>(null);
  const [uris, setUris] = useState<Record<string, string>>(
    () => Object.fromEntries(BRIDGE_SOURCES.map((s) => [s.id, s.baseUrl]))
  );

  // Mutable state (mutations don't need re-renders)
  const mut = useRef<Record<string, SourceMutable>>({});

  // Initialize mutable state once
  if (Object.keys(mut.current).length === 0) {
    for (const s of BRIDGE_SOURCES) {
      mut.current[s.id] = {
        queue: [],
        processing: false,
        ready: false,
        cfChallenge: false,
        currentReq: null,
        wasRendered: false,
        baseUrl: s.baseUrl,
        currentUri: s.baseUrl,
        webViewRef: React.createRef<WebView | null>(),
      };
    }
  }

  // ── Status helper ─────────────────────────────────────────────────────────

  const setSourceStatus = useCallback((sid: string, status: BridgeSourceStatus) => {
    webViewBridge.setStatus(sid, status);
    setStatuses((prev) => ({ ...prev, [sid]: status }));
  }, []);

  // ── Queue processor ───────────────────────────────────────────────────────

  const processNext = useCallback(
    (sid: string) => {
      const m = mut.current[sid];
      if (!m || m.processing || !m.ready || m.cfChallenge) return;
      const req = m.queue.shift();
      if (!req) {
        setSourceStatus(sid, "idle");
        return;
      }

      m.processing = true;
      m.currentReq = req;
      m.wasRendered = req.extractRendered ?? false;
      setSourceStatus(sid, "executing");

      if (req.extractRendered) {
        // Navigate WebView to the target URL — onLoadEnd will inject extraction script
        m.currentUri = req.url;
        setUris((prev) => ({ ...prev, [sid]: req.url }));
      } else {
        // Stay at base URL, inject fetch() script
        const script = buildFetchScript(req);
        setTimeout(() => {
          (m.webViewRef.current as WebView | null)?.injectJavaScript(script);
        }, 60);
      }
    },
    [setSourceStatus],
  );

  // ── Message handler ───────────────────────────────────────────────────────

  const handleMessage = useCallback(
    (sid: string, raw: string) => {
      const m = mut.current[sid];
      if (!m) return;

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      // ── CF session report ──────────────────────────────────────────────────
      if (msg.__session) {
        const isCF = Boolean(msg.isCF);
        const hasCF = Boolean(msg.hasCFClearance);
        const cookies = typeof msg.cookies === "string" ? msg.cookies : "";

        if (isCF && !m.cfChallenge) {
          m.cfChallenge = true;
          setSourceStatus(sid, "cf_challenge");
          console.log(`[bridge:${sid}] CF challenge detected — verification needed`);
        } else if (!isCF && m.cfChallenge && hasCF) {
          // CF just solved!
          m.cfChallenge = false;
          setVisibleSource(null);
          console.log(`[bridge:${sid}] CF solved — session established`);

          // Persist non-HttpOnly cookies so fetch()-based requests can use them
          if (cookies) {
            const parsed = sessionStore.parseCookieHeader(cookies);
            sessionStore.setSession(sid, parsed).catch(() => {});
          }

          // Reject any in-flight request (caller will retry)
          if (m.currentReq && m.processing) {
            webViewBridge.reject(m.currentReq.id, "CF solved — please retry");
            m.currentReq = null;
            m.processing = false;
            m.wasRendered = false;
          }

          setSourceStatus(sid, "verified");
          processNext(sid);
        }
        return;
      }

      // ── Bridge response ────────────────────────────────────────────────────
      if (msg.__bridge) {
        const id = String(msg.id ?? "");
        const ok = Boolean(msg.ok);
        const status = Number(msg.status ?? 0);
        const body = String(msg.body ?? "");
        const error = typeof msg.error === "string" ? msg.error : undefined;

        if (ok) {
          webViewBridge.resolve(id, { ok: true, status, body });
        } else if ((status === 403 || status === 503) && !m.cfChallenge) {
          // Inline fetch got blocked — CF might have challenged
          m.cfChallenge = true;
          setSourceStatus(sid, "cf_challenge");
          webViewBridge.reject(id, `CF blocked ${status}`);
        } else {
          webViewBridge.resolve(id, { ok: false, status, body: error ?? body });
        }

        const wasRendered = m.wasRendered;
        m.currentReq = null;
        m.processing = false;
        m.wasRendered = false;

        // After SPA extraction, navigate back to base URL so Referer is correct
        if (wasRendered && m.currentUri !== m.baseUrl) {
          m.currentUri = m.baseUrl;
          setUris((prev) => ({ ...prev, [sid]: m.baseUrl }));
          // onLoadEnd will fire after navigation; it will call processNext
        } else if (!m.cfChallenge) {
          processNext(sid);
        }
      }
    },
    [processNext, setSourceStatus],
  );

  // ── Load end handler ──────────────────────────────────────────────────────

  const handleLoadEnd = useCallback(
    (sid: string) => {
      const m = mut.current[sid];
      if (!m) return;

      if (!m.ready) {
        m.ready = true;
      }

      if (m.currentReq?.extractRendered && m.processing) {
        // This load was a navigation for SPA rendering → inject extraction script
        const script = buildRenderScript(m.currentReq);
        setTimeout(() => {
          (m.webViewRef.current as WebView | null)?.injectJavaScript(script);
        }, 100);
      } else {
        // Base URL load (initial, or post-SPA-reset) — start queue if not blocked
        if (!m.cfChallenge) {
          setSourceStatus(sid, "idle");
          processNext(sid);
        }
      }
    },
    [processNext, setSourceStatus],
  );

  // ── Subscribe to webViewBridge request events ─────────────────────────────

  useEffect(() => {
    const unsub = webViewBridge.onRequest((req) => {
      const m = mut.current[req.sourceId];
      if (!m) {
        webViewBridge.reject(req.id, `Source '${req.sourceId}' not managed by bridge`);
        return;
      }
      m.queue.push(req);
      processNext(req.sourceId);
    });
    return unsub;
  }, [processNext]);

  // ── Context actions ───────────────────────────────────────────────────────

  const showVerification = useCallback((sid: string) => {
    setVisibleSource(sid);
  }, []);

  const hideVerification = useCallback(() => {
    setVisibleSource(null);
  }, []);

  // ── Web platform fallback (WebView unavailable) ───────────────────────────

  if (Platform.OS === "web") {
    for (const s of BRIDGE_SOURCES) {
      if (webViewBridge.getStatus(s.id) === "initializing") {
        webViewBridge.setStatus(s.id, "idle");
      }
    }
    return (
      <BridgeContext.Provider value={{ statuses, showVerification, hideVerification }}>
        {children}
      </BridgeContext.Provider>
    );
  }

  return (
    <BridgeContext.Provider value={{ statuses, showVerification, hideVerification }}>
      {children}

      {BRIDGE_SOURCES.map((src) => {
        const m = mut.current[src.id];
        if (!m) return null;
        const isVisible = visibleSource === src.id;

        return (
          <View
            key={src.id}
            style={[
              styles.webViewWrap,
              isVisible ? styles.wrapVisible : styles.wrapHidden,
              { pointerEvents: isVisible ? "auto" : "none" },
            ]}
          >
            <WebView
              ref={m.webViewRef as React.RefObject<WebView>}
              source={{ uri: uris[src.id] ?? src.baseUrl }}
              injectedJavaScript={SESSION_JS}
              onMessage={(e) => handleMessage(src.id, e.nativeEvent.data)}
              onLoadEnd={() => handleLoadEnd(src.id)}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              javaScriptEnabled
              domStorageEnabled
              style={styles.webView}
              userAgent="Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
            />
          </View>
        );
      })}
    </BridgeContext.Provider>
  );
}

const styles = StyleSheet.create({
  webViewWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 9999,
  },
  wrapVisible: {
    opacity: 1,
  },
  wrapHidden: {
    top: -10000,
    left: -10000,
    width: 1,
    height: 1,
    opacity: 0,
    overflow: "hidden",
  },
  webView: {
    flex: 1,
  },
});
