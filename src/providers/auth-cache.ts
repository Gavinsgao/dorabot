/**
 * Disk-persisted auth cache.
 * Survives process restarts and WebSocket drops so the desktop UI
 * can show the last-known auth state without waiting for a round-trip.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DORABOT_DIR } from '../workspace.js';

const CACHE_PATH = join(DORABOT_DIR, 'auth-cache.json');

// API key auth is stable, cache for 5 minutes.
// OAuth tokens use their own expiry.
const DEFAULT_TTL_MS = 5 * 60 * 1000;

export type CachedProviderAuth = {
  provider: string;
  authenticated: boolean;
  method: 'api_key' | 'oauth' | 'none';
  identity?: string;
  error?: string;
  checkedAt: number;
  /** When this cache entry should be considered stale (ms since epoch) */
  expiresAt: number;
};

type CacheFile = {
  version: 1;
  providers: Record<string, CachedProviderAuth>;
};

// ── In-memory mirror + coalesced writes ─────────────────────────────

let cache: CacheFile | null = null;
let writeQueued = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
const WRITE_DEBOUNCE_MS = 250;

function ensureLoaded(): CacheFile {
  if (cache) return cache;
  try {
    if (existsSync(CACHE_PATH)) {
      const raw = readFileSync(CACHE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as CacheFile;
      if (parsed.version === 1 && parsed.providers) {
        cache = parsed;
        return cache;
      }
    }
  } catch { /* corrupt file, start fresh */ }
  cache = { version: 1, providers: {} };
  return cache;
}

function scheduleDiskWrite(): void {
  if (writeQueued) return;
  writeQueued = true;
  writeTimer = setTimeout(() => {
    writeQueued = false;
    writeTimer = null;
    try {
      mkdirSync(DORABOT_DIR, { recursive: true });
      writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error('[auth-cache] disk write failed:', err);
    }
  }, WRITE_DEBOUNCE_MS);
  writeTimer.unref?.();
}

// ── Public API ──────────────────────────────────────────────────────

/** Read cached auth for a provider. Returns null if missing or expired. */
export function getCachedAuth(provider: string): CachedProviderAuth | null {
  const file = ensureLoaded();
  const entry = file.providers[provider];
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) return null;
  return entry;
}

/** Read cached auth even if expired (for graceful degradation). */
export function getCachedAuthStale(provider: string): CachedProviderAuth | null {
  const file = ensureLoaded();
  return file.providers[provider] || null;
}

/** Update cache for a provider. */
export function setCachedAuth(
  provider: string,
  status: {
    authenticated: boolean;
    method: 'api_key' | 'oauth' | 'none';
    identity?: string;
    error?: string;
  },
  ttlMs = DEFAULT_TTL_MS,
): void {
  const file = ensureLoaded();
  const now = Date.now();
  file.providers[provider] = {
    provider,
    authenticated: status.authenticated,
    method: status.method,
    identity: status.identity,
    error: status.error,
    checkedAt: now,
    expiresAt: now + ttlMs,
  };
  scheduleDiskWrite();
}

/** Remove a provider from cache (e.g. on logout). */
export function clearCachedAuth(provider: string): void {
  const file = ensureLoaded();
  delete file.providers[provider];
  scheduleDiskWrite();
}

/** Get all cached providers (even if some are stale). */
export function getAllCachedAuth(): Record<string, CachedProviderAuth> {
  return { ...ensureLoaded().providers };
}

/** Force an immediate disk write (for shutdown). */
export function flushAuthCache(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
    writeQueued = false;
  }
  if (cache) {
    try {
      mkdirSync(DORABOT_DIR, { recursive: true });
      writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), { mode: 0o600 });
    } catch { /* best effort */ }
  }
}
