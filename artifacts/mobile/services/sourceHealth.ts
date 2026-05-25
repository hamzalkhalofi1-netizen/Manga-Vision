import AsyncStorage from "@react-native-async-storage/async-storage";

export type SourceErrorType =
  | "cloudflare"
  | "rate_limit"
  | "network"
  | "parse"
  | "not_found"
  | "auth"
  | "upstream";

export type SourceHealthStatus = "healthy" | "degraded" | "disabled" | "cf_blocked";

export interface HealthRecord {
  failureCount: number;
  successCount: number;
  lastFailedAt: number | null;
  lastSuccessAt: number | null;
  disabledUntil: number | null;
  lastErrorType: SourceErrorType | null;
  cfHitCount: number;
}

const KEY_PREFIX = "@sourceHealth/";
const DISABLE_AFTER_FAILURES = 6;
const DISABLE_DURATION_MS = 15 * 60 * 1000;
const CF_DISABLE_AFTER = 3;
const CF_DISABLE_DURATION_MS = 60 * 60 * 1000;

const cache = new Map<string, HealthRecord>();

function defaultHealth(): HealthRecord {
  return {
    failureCount: 0,
    successCount: 0,
    lastFailedAt: null,
    lastSuccessAt: null,
    disabledUntil: null,
    lastErrorType: null,
    cfHitCount: 0,
  };
}

async function load(sourceId: string): Promise<HealthRecord> {
  if (cache.has(sourceId)) return cache.get(sourceId)!;
  try {
    const raw = await AsyncStorage.getItem(`${KEY_PREFIX}${sourceId}`);
    if (raw) {
      const rec = JSON.parse(raw) as HealthRecord;
      cache.set(sourceId, rec);
      return rec;
    }
  } catch {}
  const rec = defaultHealth();
  cache.set(sourceId, rec);
  return rec;
}

async function save(sourceId: string, rec: HealthRecord): Promise<void> {
  cache.set(sourceId, rec);
  try {
    await AsyncStorage.setItem(`${KEY_PREFIX}${sourceId}`, JSON.stringify(rec));
  } catch {}
}

export const sourceHealth = {
  async getHealth(sourceId: string): Promise<HealthRecord> {
    return load(sourceId);
  },

  async recordFailure(sourceId: string, errorType: SourceErrorType): Promise<void> {
    const rec = await load(sourceId);
    rec.failureCount++;
    rec.lastFailedAt = Date.now();
    rec.lastErrorType = errorType;
    if (errorType === "cloudflare") {
      rec.cfHitCount++;
      if (rec.cfHitCount >= CF_DISABLE_AFTER) {
        rec.disabledUntil = Date.now() + CF_DISABLE_DURATION_MS;
      }
    } else if (rec.failureCount >= DISABLE_AFTER_FAILURES) {
      rec.disabledUntil = Date.now() + DISABLE_DURATION_MS;
    }
    await save(sourceId, rec);
  },

  async recordSuccess(sourceId: string): Promise<void> {
    const rec = await load(sourceId);
    rec.successCount++;
    rec.lastSuccessAt = Date.now();
    if (rec.failureCount > 0) rec.failureCount = Math.max(0, rec.failureCount - 1);
    if (rec.disabledUntil && rec.disabledUntil < Date.now()) {
      rec.disabledUntil = null;
      rec.cfHitCount = 0;
    }
    await save(sourceId, rec);
  },

  async clearDisable(sourceId: string): Promise<void> {
    const rec = await load(sourceId);
    rec.disabledUntil = null;
    rec.failureCount = 0;
    rec.cfHitCount = 0;
    rec.lastErrorType = null;
    await save(sourceId, rec);
  },

  async resetHealth(sourceId: string): Promise<void> {
    const rec = defaultHealth();
    cache.set(sourceId, rec);
    try {
      await AsyncStorage.removeItem(`${KEY_PREFIX}${sourceId}`);
    } catch {}
  },

  getStatus(rec: HealthRecord): SourceHealthStatus {
    if (rec.disabledUntil && rec.disabledUntil > Date.now()) {
      return rec.lastErrorType === "cloudflare" ? "cf_blocked" : "disabled";
    }
    if (rec.failureCount >= 3) return "degraded";
    return "healthy";
  },

  isDisabled(rec: HealthRecord): boolean {
    return !!(rec.disabledUntil && rec.disabledUntil > Date.now());
  },

  getDisabledRemaining(rec: HealthRecord): number {
    if (!rec.disabledUntil) return 0;
    return Math.max(0, rec.disabledUntil - Date.now());
  },
};
