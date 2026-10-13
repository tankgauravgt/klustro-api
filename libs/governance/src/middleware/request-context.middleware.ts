import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';
import { NestMiddleware } from '@nestjs/common';
import type { NextFunction } from 'express';
import type { Request } from 'express';
import type { Response } from 'express';

// import services
import { RequestContextService } from '../services/request-context.service.js';

const SAFE_REQUEST_ID = /^[\w.-]{8,100}$/;
const MAX_FORWARDED_LENGTH = 500;

// Plain address of a client: no "::ffff:" IPv4-mapped prefix and no port, or undefined when it is no IP
function normalizeIp(value: string | undefined): string | undefined {
  let address = value?.trim().replace(/^::ffff:/i, '');
  const withPort = address?.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  address = withPort
    ? withPort[1]
    : address?.replace(/^\[(.+)\](?::\d+)?$/, '$1');
  return address && isIP(address) ? address : undefined;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly context: RequestContextService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const supplied = request.header('x-request-id');
    const requestId =
      supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
    response.setHeader('x-request-id', requestId);

    // request.ip is the client as far as the trusted proxies (TRUST_PROXY) vouch for; the raw chain is evidence only
    this.context.run(
      {
        requestId,
        ip: normalizeIp(request.ip),
        peerIp: normalizeIp(request.socket.remoteAddress),
        forwardedFor: request
          .header('x-forwarded-for')
          ?.slice(0, MAX_FORWARDED_LENGTH),
        userAgent: request.header('user-agent'),
      },
      () => next(),
    );
  }
}
