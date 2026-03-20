/**
 * HTTP auth client for the desktop (Electron main process).
 * Reads the gateway token + HTTP port from disk, makes authenticated
 * requests to the HTTP auth server as a fallback when WebSocket is down.
 *
 * Zero external deps — uses Node.js built-in `http`.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import http from 'http';
import { DORABOT_DIR, GATEWAY_TOKEN_PATH } from './dorabot-paths';

const HTTP_PORT_PATH = join(DORABOT_DIR, 'http-auth.port');

function readPort(): number | null {
  try {
    if (existsSync(HTTP_PORT_PATH)) {
      const port = parseInt(readFileSync(HTTP_PORT_PATH, 'utf-8').trim(), 10);
      return Number.isFinite(port) && port > 0 ? port : null;
    }
  } catch { /* ignore */ }
  return null;
}

function readToken(): string {
  try {
    if (existsSync(GATEWAY_TOKEN_PATH)) {
      return readFileSync(GATEWAY_TOKEN_PATH, 'utf-8').trim();
    }
  } catch { /* ignore */ }
  return '';
}

type HttpResult<T> = { ok: true; data: T } | { ok: false; error: string };

function request<T>(method: string, path: string, body?: unknown, timeoutMs = 10_000): Promise<HttpResult<T>> {
  const port = readPort();
  const token = readToken();
  if (!port) return Promise.resolve({ ok: false, error: 'HTTP auth server not available (no port file)' });
  if (!token) return Promise.resolve({ ok: false, error: 'No gateway token' });

  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const text = Buffer.concat(chunks).toString('utf-8');
            const data = JSON.parse(text) as T;
            const status = res.statusCode || 500;
            if (status >= 200 && status < 300) {
              resolve({ ok: true, data });
            } else {
              resolve({ ok: false, error: (data as any)?.error || `HTTP ${status}` });
            }
          } catch (err) {
            resolve({ ok: false, error: 'Invalid JSON response' });
          }
        });
      },
    );

    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Request timed out' });
    });

    if (payload) req.write(payload);
    req.end();
  });
}

// ── Public API ──────────────────────────────────────────────────────

export type AuthStatusResult = {
  provider: string;
  authenticated: boolean;
  method: 'api_key' | 'oauth' | 'none';
  expired?: boolean;
  identity?: string;
  error?: string;
  fromCache?: boolean;
  stale?: boolean;
};

export type AuthVerifyResult = {
  authenticated: boolean;
  authType?: string;
  error?: string;
};

/** Check if the HTTP auth server is reachable. */
export async function httpAuthHealthCheck(): Promise<boolean> {
  const result = await request<{ status: string }>('GET', '/health', undefined, 3_000);
  return result.ok && result.data.status === 'ok';
}

/** Get auth status for a provider (from cache or live). */
export async function httpAuthStatus(provider = 'claude'): Promise<HttpResult<AuthStatusResult>> {
  return request<AuthStatusResult>('GET', `/auth/status?provider=${encodeURIComponent(provider)}`);
}

/** Force a fresh auth check (invalidates cache). */
export async function httpAuthRefresh(provider = 'claude'): Promise<HttpResult<AuthStatusResult>> {
  return request<AuthStatusResult>('POST', '/auth/refresh', { provider });
}

/** Verify auth by running a test query (most definitive check). */
export async function httpAuthVerify(provider = 'claude'): Promise<HttpResult<AuthVerifyResult>> {
  return request<AuthVerifyResult>('POST', '/auth/verify', { provider }, 35_000);
}

/** Check if the HTTP auth server port file exists. */
export function isHttpAuthAvailable(): boolean {
  return readPort() !== null;
}
