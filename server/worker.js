// server/worker.js — Worker 入口：/ws 升级转发到世界 DO，其余走静态资产
import { WorldDO } from './world_do.js';
export { WorldDO };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      const id = env.WORLD.idFromName('main');
      return env.WORLD.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
