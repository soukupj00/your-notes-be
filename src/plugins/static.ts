import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { sendProblem } from '../problem.ts';

/**
 * Serves the built PWA (frontend ADR 0018). Unknown GETs outside `/api` fall back to
 * `index.html` so the client router can take them; unknown `/api` paths are 404 problems.
 */
export async function registerStatic(app: FastifyInstance, publicDir: string): Promise<void> {
  const root = resolve(publicDir);
  const hasApp = existsSync(join(root, 'index.html'));
  if (hasApp) {
    await app.register(fastifyStatic, { root });
  } else {
    app.log.warn({ publicDir: root }, 'no index.html in PUBLIC_DIR; serving the API only');
  }

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?', 1)[0]!;
    const isApi = path === '/api' || path.startsWith('/api/');
    if (hasApp && !isApi && (request.method === 'GET' || request.method === 'HEAD')) {
      return reply.sendFile('index.html');
    }
    return sendProblem(reply, 404, `No route for ${request.method} ${request.url}`);
  });
}
