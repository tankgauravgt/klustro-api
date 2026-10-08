import { AsyncLocalStorage } from 'node:async_hooks';
import type { DataSource } from 'typeorm';

/*
 * SQLite through better-sqlite3 has ONE connection, and TypeORM hands every caller the same query
 * runner. A transaction is then not "this request's": whatever any other request runs while it is
 * open lands inside it, and a nested transaction is just a SAVEPOINT in someone else's. One request
 * rolling back can undo another's writes, and a commit can release another's savepoint.
 *
 * The gate fixes that without changing any caller. Work is grouped by "scope" (one per HTTP
 * request, see `inDatabaseScope`). While a scope has a transaction open, every query, and every
 * transaction, from any other scope waits; the owner's own queries and nested transactions go
 * straight through. Queries outside a transaction take the gate for the length of one statement.
 *
 * Use it only for a single-connection database: it makes all database work take turns.
 */

const scopes = new AsyncLocalStorage<object>();
// Work started outside any request (start-up, tests) shares one scope
const UNSCOPED = {};

// Runs `callback` as one scope. Inside an existing scope it just runs, so a child can never end
// up waiting for the transaction of the parent that is waiting for it.
export function inDatabaseScope<T>(callback: () => T): T {
  return scopes.getStore() ? callback() : scopes.run({}, callback);
}

const serialized = new WeakSet<DataSource>();

// True once `serializeTransactions` has been applied to this data source
export function isDatabaseSerialized(dataSource: DataSource): boolean {
  return serialized.has(dataSource);
}

export class TransactionGate {
  private holder: object | null = null;
  private held = 0;
  private waiting: Array<() => void> = [];

  private static scope(): object {
    return scopes.getStore() ?? UNSCOPED;
  }

  async acquire(): Promise<void> {
    const scope = TransactionGate.scope();
    // The check and the claim below happen in the same tick, so two waiters cannot both win
    while (this.holder !== null && this.holder !== scope) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.holder = scope;
    this.held += 1;
  }

  release(): void {
    this.held -= 1;
    if (this.held === 0) {
      this.holder = null;
      for (const wake of this.waiting.splice(0)) {
        wake();
      }
    }
  }

  heldByCurrentScope(): boolean {
    return this.held > 0 && this.holder === TransactionGate.scope();
  }
}

// The parts of a TypeORM query runner the gate wraps
export interface GatedQueryRunner {
  isTransactionActive: boolean;
  query(...args: any[]): Promise<any>;
  startTransaction(...args: any[]): Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;
}

/*
 * Wraps the single query runner in place. `isTransactionActive` reads false for every scope but
 * the owner's: TypeORM's save() checks it to decide whether to open its own transaction, and a
 * scope that wrongly sees someone else's would write without one.
 */
export function gateQueryRunner(runner: GatedQueryRunner): TransactionGate {
  const gate = new TransactionGate();
  const original = {
    query: runner.query.bind(runner),
    start: runner.startTransaction.bind(runner),
    commit: runner.commitTransaction.bind(runner),
    rollback: runner.rollbackTransaction.bind(runner),
  };
  // Transaction levels this gate is holding open (a nested one is a savepoint)
  let open = 0;

  let active = runner.isTransactionActive;
  Object.defineProperty(runner, 'isTransactionActive', {
    configurable: true,
    get: () => active && gate.heldByCurrentScope(),
    set: (value: boolean) => {
      active = value;
    },
  });

  runner.query = async (...args) => {
    await gate.acquire();
    try {
      return await original.query(...args);
    } finally {
      gate.release();
    }
  };

  runner.startTransaction = async (...args) => {
    await gate.acquire();
    try {
      await original.start(...args);
      open += 1;
    } catch (error) {
      gate.release();
      throw error;
    }
  };

  // A failed commit keeps the gate: TypeORM follows it with a rollback, which lets go
  runner.commitTransaction = async () => {
    await original.commit();
    open -= 1;
    gate.release();
  };

  runner.rollbackTransaction = async () => {
    if (open === 0) {
      return original.rollback();
    }
    try {
      await original.rollback();
    } finally {
      open -= 1;
      gate.release();
    }
  };

  return gate;
}

export function serializeTransactions(dataSource: DataSource): void {
  if (serialized.has(dataSource)) {
    return;
  }
  // Only this driver shares one query runner; for any other the wrapper would do nothing useful
  if (dataSource.options.type !== 'better-sqlite3') {
    throw new Error(
      `USE_SQLITE_DATABASE=1 needs the better-sqlite3 driver, not ${dataSource.options.type}`,
    );
  }
  gateQueryRunner(
    dataSource.createQueryRunner() as unknown as GatedQueryRunner,
  );
  serialized.add(dataSource);
}
