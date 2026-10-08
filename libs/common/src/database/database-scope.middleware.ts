import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction } from 'express';
import type { Request } from 'express';
import type { Response } from 'express';

// import services
import { inDatabaseScope } from './transaction-gate.js';

// Makes each HTTP request one database scope, so the gate can tell whose transaction is whose
@Injectable()
export class DatabaseScopeMiddleware implements NestMiddleware {
  use(_request: Request, _response: Response, next: NextFunction): void {
    inDatabaseScope(() => next());
  }
}
