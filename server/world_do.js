// server/world_do.js — 世界 Durable Object（M1 骨架，逻辑在下一任务补全）
export class WorldDO {
  constructor(ctx, env) {
    this.ctx = ctx;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(ws, raw) {}
  webSocketClose(ws, code, reason, wasClean) {}
  webSocketError(ws, error) {}
}
