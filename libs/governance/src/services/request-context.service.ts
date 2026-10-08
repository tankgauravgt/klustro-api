import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

// import interfaces
import type { RequestContext } from '../interfaces/request-context.js';

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  run<T>(context: RequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  get(): RequestContext | undefined {
    return this.storage.getStore();
  }

  actorId(): string | null {
    return this.get()?.actorId ?? null;
  }

  setActor(actorId: string | undefined): void {
    const context = this.get();
    if (context && actorId) {
      context.actorId = actorId;
    }
  }

  setOperation(operation: string): void {
    const context = this.get();
    if (context) {
      context.operation = operation;
    }
  }
}
