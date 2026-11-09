export interface Env {
  GAMES_DB: D1Database;
  ENVIRONMENT: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, environment: env.ENVIRONMENT, service: "max-games-gateway" });
    }

    const result = await env.GAMES_DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();

    return Response.json({
      ok: true,
      environment: env.ENVIRONMENT,
      dbReady: Boolean(result?.ok),
      path: url.pathname,
    });
  },
};
