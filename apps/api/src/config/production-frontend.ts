import fastifyStatic from '@fastify/static';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

async function findFrontendDirectory(): Promise<string> {
  const candidates = [
    resolve(process.cwd(), 'apps/web/dist'),
    resolve(process.cwd(), '../web/dist'),
  ];
  for (const directory of candidates) {
    try {
      await access(resolve(directory, 'index.html'));
      return directory;
    } catch {
      // Try the next supported npm workspace location.
    }
  }
  throw new Error('El bundle frontend no existe. Ejecuta el build antes de iniciar producción.');
}

export async function configureProductionFrontend(app: NestFastifyApplication): Promise<void> {
  const frontendDirectory = await findFrontendDirectory();
  await app.register(fastifyStatic, {
    root: frontendDirectory,
    prefix: '/',
    wildcard: false,
    cacheControl: false,
    setHeaders: (response, path) => {
      response.header(
        'cache-control',
        path.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
      );
    },
  });

  const server = app.getHttpAdapter().getInstance();
  server.get('/*', async (request, reply) => {
    const pathname = request.url.split('?', 1)[0] || '/';
    if (pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/socket.io')) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'El recurso solicitado no existe.' },
      });
    }

    reply.header('cache-control', 'no-cache');
    return reply.type('text/html; charset=utf-8').sendFile('index.html');
  });
}
