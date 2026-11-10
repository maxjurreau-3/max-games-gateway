import type { Context, MiddlewareHandler } from 'hono';
import type { Env } from '../index';

const MAX_DRIFT_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;

export const hmacAuthMiddleware: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const timestampHeader = c.req.header('X-Timestamp');
  const nonce = c.req.header('X-Nonce');
  const signature = c.req.header('X-Signature');
  const secret = c.env.HMAC_SECRET;

  if (!timestampHeader || !nonce || !signature) {
    return c.json({ success: false, error: 'Missing HMAC authentication headers' }, 401);
  }
  if (!/^\d{13}$/.test(timestampHeader) || !/^[0-9a-f-]{36}$/i.test(nonce) || !/^(?:[0-9a-f]{2}){32}$/i.test(signature)) {
    return c.json({ success: false, error: 'Invalid HMAC authentication headers' }, 401);
  }
  const timestamp = Number(timestampHeader);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > MAX_DRIFT_MS) {
    return c.json({ success: false, error: 'Request timestamp expired' }, 401);
  }
  if (!secret || secret.length < 32) {
    console.error('HMAC_SECRET is missing or too short');
    return c.json({ success: false, error: 'Authentication is not configured' }, 503);
  }

  try {
    const rawBody = await c.req.raw.clone().text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return c.json({ success: false, error: 'Request body too large' }, 413);
    }
    const canonical = `${timestampHeader}:${nonce}:${c.req.method.toUpperCase()}:${c.req.url}:${rawBody}`;
    const signatureBytes = Uint8Array.from(signature.match(/.{2}/g)!, (byte) => Number.parseInt(byte, 16));
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    );
    const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, new TextEncoder().encode(canonical));
    if (!valid) return c.json({ success: false, error: 'Invalid HMAC signature' }, 401);

    await c.env.DB.prepare('DELETE FROM processed_nonces WHERE timestamp < ?')
      .bind(Date.now() - MAX_DRIFT_MS).run();
    const inserted = await c.env.DB.prepare(
      'INSERT OR IGNORE INTO processed_nonces (nonce, timestamp) VALUES (?, ?)',
    ).bind(nonce, timestamp).run();
    if (inserted.meta.changes === 0) return c.json({ success: false, error: 'Request nonce already used' }, 401);

    await next();
  } catch (error) {
    console.error('HMAC request verification failed', error instanceof Error ? error.message : 'unknown error');
    return c.json({ success: false, error: 'Authentication service unavailable' }, 503);
  }
};
