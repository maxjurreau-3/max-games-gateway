import { DurableObject } from 'cloudflare:workers';

export interface PhysicsState {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  timestamp: number;
}

interface PhysicsUpdate {
  position: PhysicsState['position'];
  velocity: PhysicsState['velocity'];
  stakeAmount?: number;
}

const STATE_KEY = 'physicsState';
const AXES = ['x', 'y', 'z'] as const;

function isVector(value: unknown): value is { x: number; y: number; z: number } {
  if (!value || typeof value !== 'object') return false;
  const vector = value as Record<string, unknown>;
  return AXES.every((axis) => typeof vector[axis] === 'number' && Number.isFinite(vector[axis]));
}

export class GameRoomDO extends DurableObject {
  private currentState: PhysicsState = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    timestamp: Date.now(),
  };

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.currentState = (await this.ctx.storage.get<PhysicsState>(STATE_KEY)) ?? this.currentState;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/websocket' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ type: 'INIT_STATE', state: this.currentState }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/physics-update' && request.method === 'POST') {
      let data: PhysicsUpdate;
      try {
        data = await request.json<PhysicsUpdate>();
      } catch {
        return Response.json({ success: false, error: 'Request body must be valid JSON' }, { status: 400 });
      }

      if (
        !data || !isVector(data.position) || !isVector(data.velocity) ||
        (data.stakeAmount !== undefined &&
          (typeof data.stakeAmount !== 'number' || !Number.isFinite(data.stakeAmount) || data.stakeAmount < 0))
      ) {
        return Response.json({ success: false, error: 'Invalid position, velocity, or stake amount' }, { status: 400 });
      }

      const now = Date.now();
      const dt = Math.min(Math.max((now - this.currentState.timestamp) / 1000, 0), 0.1);
      this.currentState = {
        position: {
          x: data.position.x + data.velocity.x * dt,
          y: data.position.y + data.velocity.y * dt,
          z: data.position.z + data.velocity.z * dt,
        },
        velocity: data.velocity,
        timestamp: now,
      };
      await this.ctx.storage.put(STATE_KEY, this.currentState);

      const message = JSON.stringify({ type: 'STATE_UPDATE', state: this.currentState });
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(message);
        } catch {
          try { socket.close(1011, 'State broadcast failed'); } catch { /* already closed */ }
        }
      }

      return Response.json({ success: true, state: this.currentState });
    }

    if (url.pathname === '/state' && request.method === 'GET') {
      return Response.json({ state: this.currentState });
    }

    return new Response('Not found', { status: 404 });
  }
}
