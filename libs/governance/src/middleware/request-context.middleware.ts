import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { NestMiddleware } from '@nestjs/common';
import type { NextFunction } from 'express';
import type { Request } from 'express';
import type { Response } from 'express';

// import services
import { RequestContextService } from '../services/request-context.service.js';

const SAFE_REQUEST_ID = /^[\w.-]{8,100}$/;

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly context: RequestContextService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const supplied = request.header('x-request-id');
    const requestId =
      supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
    response.setHeader('x-request-id', requestId);

    this.context.run(
      { requestId, ip: request.ip, userAgent: request.header('user-agent') },
      () => next(),
    );
  }
}
