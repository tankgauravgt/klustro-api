import { CallHandler } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';

// import services
import { RequestContextService } from '../services/request-context.service.js';

/*
 * Runs after the auth guard, so `request.user` is known: it records who is
 * acting and which controller action is running on the request context.
 */
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  constructor(private readonly context: RequestContextService) {}

  intercept(
    execution: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const request = execution
      .switchToHttp()
      .getRequest<{ user?: { id?: string } }>();
    this.context.setActor(request.user?.id);
    this.context.setOperation(
      `${execution.getClass().name}.${execution.getHandler().name}`,
    );
    return next.handle();
  }
}
