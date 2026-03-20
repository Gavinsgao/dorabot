/**
 * Lightweight HTTP auth server.
 * Runs alongside the WebSocket gateway on a localhost TCP port.
 * Provides stateless auth status, verification, and health endpoints
 * so the desktop can check auth even when the Unix-socket WS is down.
 *
 * Zero external dependencies — only Node.js built-in `http`.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DORABOT_DIR, GATEWAY_TOKEN_PATH } from '../workspace.js';
import { getProviderByName } from '../providers/index.js';
import { buildProviderAuthGate } from './auth-state.js';
import { getCachedAuth, setCachedAuth, getAllCachedAuth, type CachedProviderAuth } from '../providers/auth-cache.js';
import type { ProviderName } from '../config.js';

const HTTP_PORT_PATH = join(DORABOT_DIR, 'http-auth.port');

// ── Helpers ─────────────────────────────────────────────────────────

function readGatewayToken(): string {
  try {
    if (existsSync(GATEWAY_TOKEN_PATH)) {
      return readFileSync(GATEWAY_TOKEN_PATH, 'utf-8').trim();
    }
  } catch { /* ignore */ }
  return '';
}

function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64 * 1024) { // 64KB guard
        req.destroy();
        reject(new Error('body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// ── Auth middleware ──────────────────────────────────────────────────

function authenticateRequest(req: IncomingMessage): boolean {
  const token = readGatewayToken();
  if (!token) return false; // no token configured = deny all
  const authHeader = req.headers.authorization;
  if (!authHeader) return false;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] === token;
}

// ── Route handlers ──────────────────────────────────────────────────

async function handleHealth(_req: IncomingMessage, res: ServerResponse, startedAt: number): Promise<void> {
  json(res, 200, { status: 'ok', uptime: Date.now() - startedAt });
}

async function handleAuthStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authenticateRequest(req)) { json(res, 401, { error: 'unauthorized' }); return; }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const providerName = url.searchParams.get('provider') || 'claude';

  // Try cache first for fast response
  const cached = getCachedAuth(providerName);
  if (cached) {
    json(res, 200, { ...cached, fromCache: true });
    return;
  }

  // Cache miss or stale: query live provider
  try {
    const provider = await getProviderByName(providerName);
    const status = await provider.getAuthStatus();
    const gate = buildProviderAuthGate(providerName as ProviderName, status);

    // Update cache
    const method = gate.method;
    const ttl = method === 'oauth' && status.nextRefreshAt
      ? Math.max(status.nextRefreshAt - Date.now(), 60_000)
      : undefined;
    setCachedAuth(providerName, {
      authenticated: gate.authenticated,
      method,
      identity: status.identity,
      error: gate.error,
    }, ttl);

    json(res, 200, {
      provider: providerName,
      authenticated: gate.authenticated,
      method,
      expired: gate.expired,
      identity: status.identity,
      error: gate.error,
      fromCache: false,
    });
  } catch (err) {
    // Provider query failed, try stale cache
    const stale = getCachedAuth(providerName);
    if (stale) {
      json(res, 200, { ...stale, fromCache: true, stale: true });
    } else {
      json(res, 500, { error: err instanceof Error ? err.message : 'Provider query failed' });
    }
  }
}

async function handleAuthRefresh(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authenticateRequest(req)) { json(res, 401, { error: 'unauthorized' }); return; }

  let body: { provider?: string } = {};
  try {
    const raw = await readBody(req);
    if (raw) body = JSON.parse(raw);
  } catch { /* use defaults */ }

  const providerName = body.provider || 'claude';

  try {
    const provider = await getProviderByName(providerName);
    await provider.invalidateAuthCache?.();
    const status = await provider.getAuthStatus();
    const gate = buildProviderAuthGate(providerName as ProviderName, status);

    // Update cache
    setCachedAuth(providerName, {
      authenticated: gate.authenticated,
      method: gate.method,
      identity: status.identity,
      error: gate.error,
    });

    json(res, 200, {
      provider: providerName,
      authenticated: gate.authenticated,
      method: gate.method,
      error: gate.error,
      refreshed: true,
    });
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : 'Refresh failed' });
  }
}

async function handleAuthVerify(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authenticateRequest(req)) { json(res, 401, { error: 'unauthorized' }); return; }

  let body: { provider?: string } = {};
  try {
    const raw = await readBody(req);
    if (raw) body = JSON.parse(raw);
  } catch { /* use defaults */ }

  const providerName = body.provider || 'claude';

  try {
    const provider = await getProviderByName(providerName);

    // Use verifyAuth if available (Phase 3), otherwise fall back to getAuthStatus
    const verifyFn = (provider as any).verifyAuth;
    if (typeof verifyFn === 'function') {
      const result = await verifyFn.call(provider);
      // Update cache with verified result
      setCachedAuth(providerName, {
        authenticated: result.authenticated,
        method: result.authType === 'oauth' ? 'oauth' : result.authType === 'api_key' ? 'api_key' : 'none',
        error: result.error,
      });
      json(res, 200, result);
    } else {
      // Fallback: invalidate + re-check
      await provider.invalidateAuthCache?.();
      const status = await provider.getAuthStatus();
      const gate = buildProviderAuthGate(providerName as ProviderName, status);
      setCachedAuth(providerName, {
        authenticated: gate.authenticated,
        method: gate.method,
        identity: status.identity,
        error: gate.error,
      });
      json(res, 200, {
        authenticated: gate.authenticated,
        authType: gate.method,
        error: gate.error,
      });
    }
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : 'Verification failed' });
  }
}

async function handleProviders(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authenticateRequest(req)) { json(res, 401, { error: 'unauthorized' }); return; }
  const cached = getAllCachedAuth();
  json(res, 200, { providers: cached });
}

// ── Server lifecycle ────────────────────────────────────────────────

export type HttpAuthServer = {
  port: number;
  close: () => Promise<void>;
};

export async function startHttpAuthServer(): Promise<HttpAuthServer> {
  const startedAt = Date.now();

  const server: Server = createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    try {
      if (path === '/health' && req.method === 'GET') {
        await handleHealth(req, res, startedAt);
      } else if (path === '/auth/status' && req.method === 'GET') {
        await handleAuthStatus(req, res);
      } else if (path === '/auth/refresh' && req.method === 'POST') {
        await handleAuthRefresh(req, res);
      } else if (path === '/auth/verify' && req.method === 'POST') {
        await handleAuthVerify(req, res);
      } else if (path === '/providers' && req.method === 'GET') {
        await handleProviders(req, res);
      } else {
        json(res, 404, { error: 'not found' });
      }
    } catch (err) {
      console.error('[http-auth] unhandled error:', err);
      json(res, 500, { error: 'internal error' });
    }
  });

  // Bind to localhost on random port
  const port = await new Promise<number>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('unexpected address format'));
        return;
      }
      resolve(addr.port);
    });
  });

  // Write port to disk so desktop can find it
  try {
    writeFileSync(HTTP_PORT_PATH, String(port), { mode: 0o600 });
    console.log(`[http-auth] listening on 127.0.0.1:${port} (port file: ${HTTP_PORT_PATH})`);
  } catch (err) {
    console.error('[http-auth] failed to write port file:', err);
  }

  return {
    port,
    close: () => new Promise<void>((resolve) => {
      server.close(() => {
        // Clean up port file
        try {
          if (existsSync(HTTP_PORT_PATH)) unlinkSync(HTTP_PORT_PATH);
        } catch { /* ignore */ }
        resolve();
      });
    }),
  };
}

export { HTTP_PORT_PATH };
