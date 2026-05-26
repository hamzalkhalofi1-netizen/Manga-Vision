import React, { useRef, useState, useCallback, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Linking,
} from "react-native";
import { sessionStore } from "@/services/sessionStore";
import { sourceHealth } from "@/services/sourceHealth";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  onVerified: () => void;
  onDismiss: () => void;
  onChangeSource?: () => void;
}

let WebView: React.ComponentType<{
  source: { uri: string };
  injectedJavaScript?: string;
  onMessage?: (e: { nativeEvent: { data: string } }) => void;
  onLoadEnd?: () => void;
  style?: object;
  javaScriptEnabled?: boolean;
  domStorageEnabled?: boolean;
  sharedCookiesEnabled?: boolean;
  thirdPartyCookiesEnabled?: boolean;
  userAgent?: string;
}> | null = null;

if (Platform.OS !== "web") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    WebView = require("react-native-webview").WebView;
  } catch {}
}

/**
 * Injected JS to extract:
 * 1. document.cookie (non-HttpOnly cookies)
 * 2. localStorage session tokens
 * 3. Whether this is a Cloudflare challenge page
 *
 * On iOS with sharedCookiesEnabled, HttpOnly cookies (cf_clearance) are
 * shared automatically with the native HTTP stack. We detect verification
 * success by checking that the challenge UI is gone, not by reading cf_clearance.
 */
const SESSION_INJECT_JS = `
(function() {
  var CF_SIGNATURES = [
    'cf-browser-verification','challenge-form','__cf_chl_opt',
    'chl-api','turnstile','_cf_chl_enter'
  ];
  var CF_TITLES = ['just a moment','checking your browser','attention required'];

  function isChallengePage() {
    try {
      var t = document.title.toLowerCase();
      if (CF_TITLES.some(function(w){ return t.indexOf(w) >= 0; })) return true;
      var h = document.documentElement.innerHTML || '';
      return CF_SIGNATURES.some(function(s){ return h.indexOf(s) >= 0; });
    } catch(e){ return false; }
  }

  function parseCookies() {
    var r = {};
    try {
      var pairs = document.cookie.split(';');
      for (var i = 0; i < pairs.length; i++) {
        var p = pairs[i].trim(); var eq = p.indexOf('=');
        if (eq > 0) r[p.slice(0,eq).trim()] = p.slice(eq+1).trim();
      }
    } catch(e){}
    return r;
  }

  function getLS() {
    var ls = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i); if (!k) continue;
        var lk = k.toLowerCase();
        if (lk.indexOf('token')>=0||lk.indexOf('session')>=0||
            lk.indexOf('auth')>=0||lk.indexOf('user')>=0) {
          ls[k] = localStorage.getItem(k)||'';
        }
      }
    } catch(e){}
    return ls;
  }

  function send() {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type:'session',
        cookies: parseCookies(),
        isChallengePage: isChallengePage(),
        url: window.location.href,
        title: document.title,
        localStorage: getLS(),
      }));
    } catch(e){}
  }
  send();
  setInterval(send, 1500);
  true;
})();
`;

export default function SourceVerificationModal({
  visible,
  sourceId,
  sourceName,
  sourceUrl,
  onVerified,
  onDismiss,
  onChangeSource,
}: Props) {
  const colors = useColors();
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [pageTitle, setPageTitle] = useState("");
  const verifiedRef = useRef(false);
  const sessionSavedRef = useRef(false);

  useEffect(() => {
    if (visible) {
      setLoading(true);
      setVerified(false);
      setPageTitle("");
      verifiedRef.current = false;
      sessionSavedRef.current = false;
    }
  }, [visible]);

  const handleMessage = useCallback(
    async (event: { nativeEvent: { data: string } }) => {
      if (verifiedRef.current) return;
      try {
        const raw = JSON.parse(event.nativeEvent.data) as {
          type: string;
          cookies?: Record<string, string>;
          isChallengePage?: boolean;
          url?: string;
          title?: string;
          localStorage?: Record<string, string>;
        };
        if (raw.type !== "session") return;

        const { cookies = {}, isChallengePage, localStorage: ls = {}, title = "" } = raw;
        if (title) setPageTitle(title);

        // Save all readable cookies (non-HttpOnly)
        if (Object.keys(cookies).length > 0) {
          sessionSavedRef.current = true;
          await sessionStore.setSession(sourceId, cookies);
        }

        // Save relevant localStorage values as session data
        const relevantLs: Record<string, string> = {};
        for (const [k, v] of Object.entries(ls)) {
          relevantLs[`__ls_${k}`] = v;
        }
        if (Object.keys(relevantLs).length > 0) {
          await sessionStore.setSession(sourceId, relevantLs);
        }

        // Verification success:
        // 1. cf_clearance in document.cookie (rare — usually HttpOnly)
        // 2. Page is NOT a challenge page AND we have any cookies saved
        //    (on iOS with sharedCookiesEnabled, cf_clearance is auto-shared
        //     with the native HTTP stack even though JS can't read it)
        // 3. Page is NOT a challenge page AND session was previously saved
        const cfCookie = "cf_clearance" in cookies;
        const notChallenge = !isChallengePage;
        const hasCookies = Object.keys(cookies).length > 0;

        const isVerified = cfCookie || (notChallenge && (hasCookies || sessionSavedRef.current));

        if (isVerified) {
          verifiedRef.current = true;
          await sourceHealth.clearDisable(sourceId);
          setVerified(true);
          setTimeout(() => onVerified(), 800);
        }
      } catch {}
    },
    [sourceId, onVerified],
  );

  const c = colors;

  // Web platform: can't embed a WebView — offer to open in browser
  if (Platform.OS === "web" || !WebView) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
        <View style={[st.overlay]}>
          <View style={[st.card, { backgroundColor: c.card }]}>
            <Text style={st.lockIcon}>🔒</Text>
            <Text style={[st.title, { color: c.foreground }]}>Browser Verification Required</Text>
            <Text style={[st.body, { color: c.mutedForeground }]}>
              <Text style={[st.bold, { color: c.foreground }]}>{sourceName}</Text> uses bot
              protection that requires a real browser session.{"\n\n"}Open the site in your browser,
              then come back and tap <Text style={[st.bold, { color: c.foreground }]}>Retry</Text>.
            </Text>

            <TouchableOpacity
              style={[st.btn, st.btnPrimary, { backgroundColor: c.accent }]}
              onPress={() => Linking.openURL(sourceUrl)}
            >
              <Text style={[st.btnPrimaryText]}>Open in Browser</Text>
            </TouchableOpacity>

            <View style={st.row}>
              {onChangeSource && (
                <TouchableOpacity
                  style={[st.btn, st.btnOutline, { borderColor: c.border }]}
                  onPress={onChangeSource}
                >
                  <Text style={[st.btnOutlineText, { color: c.foreground }]}>Change Source</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[st.btn, st.btnOutline, { borderColor: c.border }]}
                onPress={onDismiss}
              >
                <Text style={[st.btnOutlineText, { color: c.foreground }]}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  // Native: embedded WebView for real CF challenge solving
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onDismiss}>
      <View style={[st.nativeContainer, { backgroundColor: c.background }]}>
        <View style={[st.nativeHeader, { backgroundColor: c.card, borderBottomColor: c.border }]}>
          <TouchableOpacity style={st.headerSide} onPress={onDismiss}>
            <Text style={[st.cancelText, { color: c.accent }]}>Cancel</Text>
          </TouchableOpacity>

          <View style={st.headerCenter}>
            {verified ? (
              <Text style={[st.verifiedHeaderText]}>✓ Verified!</Text>
            ) : (
              <>
                <Text style={[st.headerTitle, { color: c.foreground }]} numberOfLines={1}>
                  Verify: {sourceName}
                </Text>
                {loading && (
                  <ActivityIndicator size="small" color={c.accent} style={{ marginTop: 3 }} />
                )}
              </>
            )}
          </View>

          {onChangeSource ? (
            <TouchableOpacity style={st.headerSide} onPress={onChangeSource}>
              <Text style={[st.switchText, { color: c.mutedForeground }]}>Switch</Text>
            </TouchableOpacity>
          ) : (
            <View style={st.headerSide} />
          )}
        </View>

        {!verified && (
          <View
            style={[
              st.infoBanner,
              { backgroundColor: colors.isDark ? "#0f172a" : "#f0f4ff" },
            ]}
          >
            <Text
              style={[st.infoBannerText, { color: colors.isDark ? "#94a3b8" : "#475569" }]}
            >
              🔒 Complete any security check below to unlock{" "}
              <Text style={{ fontWeight: "700" }}>{sourceName}</Text>
            </Text>
            {pageTitle ? (
              <Text
                style={[st.infoBannerText, { color: colors.isDark ? "#64748b" : "#94a3b8", fontSize: 11, marginTop: 3 }]}
                numberOfLines={1}
              >
                {pageTitle}
              </Text>
            ) : null}
          </View>
        )}

        {verified ? (
          <View style={st.verifiedCenter}>
            <Text style={st.verifiedEmoji}>✅</Text>
            <Text style={[st.verifiedTitle, { color: c.foreground }]}>Session Verified!</Text>
            <Text style={[st.verifiedSub, { color: c.mutedForeground }]}>
              Retrying content load…
            </Text>
          </View>
        ) : (
          <WebView
            source={{ uri: sourceUrl }}
            injectedJavaScript={SESSION_INJECT_JS}
            onMessage={handleMessage}
            onLoadEnd={() => setLoading(false)}
            style={st.webview}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
          />
        )}
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    borderRadius: 20,
    padding: 28,
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  lockIcon: { fontSize: 44 },
  title: { fontSize: 18, fontWeight: "700", textAlign: "center" },
  body: { fontSize: 14, textAlign: "center", lineHeight: 21 },
  bold: { fontWeight: "700" },
  row: { flexDirection: "row", gap: 10, width: "100%" },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  btnPrimary: {},
  btnPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  btnOutline: { borderWidth: 1.5 },
  btnOutlineText: { fontWeight: "600", fontSize: 14 },

  nativeContainer: { flex: 1 },
  nativeHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 56,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: { width: 72, alignItems: "center" },
  cancelText: { fontSize: 16 },
  switchText: { fontSize: 15 },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: 16, fontWeight: "600" },
  verifiedHeaderText: { fontSize: 17, fontWeight: "700", color: "#22c55e" },

  infoBanner: { paddingVertical: 10, paddingHorizontal: 16, alignItems: "center" },
  infoBannerText: { fontSize: 13, textAlign: "center" },

  verifiedCenter: { flex: 1, justifyContent: "center", alignItems: "center", gap: 16 },
  verifiedEmoji: { fontSize: 72 },
  verifiedTitle: { fontSize: 24, fontWeight: "700" },
  verifiedSub: { fontSize: 15 },

  webview: { flex: 1 },
});
