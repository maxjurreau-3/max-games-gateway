import { Hono } from 'hono';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import { hmacAuthMiddleware } from './middleware/hmac';

export interface Env {
  DB: D1Database;
  GAME_ROOM: DurableObjectNamespace;
  HMAC_SECRET: string;
  ENVIRONMENT: string;
}

// Export the actual class configured as GAME_ROOM in wrangler.toml.
export { GameRoomDO } from './durable-objects/GameRoomDO';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ ok: true, environment: c.env.ENVIRONMENT, service: 'max-games-gateway' }));

app.get('/api/v1/public/status', async (c) => {
  try {
    const result = await c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
    return c.json({ ok: true, dbReady: Boolean(result?.ok) });
  } catch {
    return c.json({ ok: false, error: 'Database unavailable' }, 503);
  }
});

app.post('/api/v1/games/vector-state', hmacAuthMiddleware, async (c) => {
  let body: {
    sessionId?: unknown;
    position?: unknown;
    velocity?: unknown;
    stakeAmount?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Request body must be valid JSON' }, 400);
  }

  const validVector = (value: unknown): value is { x: number; y: number; z: number } => {
    if (!value || typeof value !== 'object') return false;
    const vector = value as Record<string, unknown>;
    return ['x', 'y', 'z'].every((axis) => typeof vector[axis] === 'number' && Number.isFinite(vector[axis]));
  };
  if (
    typeof body.sessionId !== 'string' || !body.sessionId.trim() || body.sessionId.length > 200 ||
    !validVector(body.position) || !validVector(body.velocity) ||
    (body.stakeAmount !== undefined &&
      (typeof body.stakeAmount !== 'number' || !Number.isFinite(body.stakeAmount) || body.stakeAmount < 0))
  ) {
    return c.json({ success: false, error: 'Invalid session, vector, or stake amount' }, 400);
  }

  try {
    const sessionId = body.sessionId.trim();
    const position = body.position;
    const velocity = body.velocity;
    const stakeAmount = body.stakeAmount ?? 0;
    const id = c.env.GAME_ROOM.idFromName(sessionId);
    const room = c.env.GAME_ROOM.get(id);
    const physicsResponse = await room.fetch(new Request('https://game-room.internal/physics-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position, velocity, stakeAmount }),
    }));
    if (!physicsResponse.ok) {
      console.error('Game room rejected physics update', physicsResponse.status);
      return c.json({ success: false, error: 'Physics state synchronization failed' }, 502);
    }
    const physicsState: unknown = await physicsResponse.json();

    await c.env.DB.prepare(
      `INSERT INTO vector_stakes
       (stake_id, session_id, pos_x, pos_y, pos_z, vel_x, vel_y, vel_z, stake_amount, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), sessionId,
      position.x, position.y, position.z,
      velocity.x, velocity.y, velocity.z,
      stakeAmount, Date.now(),
    ).run();

    return c.json({ success: true, session_id: sessionId, physics_state: physicsState, timestamp: Date.now() });
  } catch (error) {
    console.error('Vector state update failed', error instanceof Error ? error.message : 'unknown error');
    return c.json({ success: false, error: 'Unable to synchronize vector state' }, 500);
  }
});

app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));
export default app;
