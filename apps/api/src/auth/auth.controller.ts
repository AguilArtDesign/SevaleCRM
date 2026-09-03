import { All, Controller, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service.js';
import { Public } from './public.decorator.js';

function createWebRequest(request: FastifyRequest): Request {
  const protocol = request.protocol;
  const host = request.headers.host || 'localhost:3000';
  const method = request.method.toUpperCase();
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  headers.delete('content-length');
  headers.set('x-client-ip', request.ip);

  const body =
    method === 'GET' || method === 'HEAD' || request.body === undefined
      ? undefined
      : typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body);

  return new Request(`${protocol}://${host}${request.raw.url || ''}`, { method, headers, body });
}

const FORWARDED_AUTH_HEADERS = new Set([
  'cache-control',
  'content-type',
  'location',
  'retry-after',
  'vary',
  'www-authenticate',
]);

@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @All('*')
  async handle(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const response = await this.authService.auth.handler(createWebRequest(request));
    const setCookies = response.headers.getSetCookie();

    response.headers.forEach((value, name) => {
      if (FORWARDED_AUTH_HEADERS.has(name)) reply.header(name, value);
    });
    if (setCookies.length > 0) reply.header('set-cookie', setCookies);

    reply.status(response.status);
    const body = response.body ? Buffer.from(await response.arrayBuffer()) : undefined;
    await reply.send(body);
  }
}
