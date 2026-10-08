import { beforeEach } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';

import { gateQueryRunner } from './transaction-gate.js';
import { inDatabaseScope } from './transaction-gate.js';
import type { GatedQueryRunner } from './transaction-gate.js';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/*
 * Behaves like the one TypeORM query runner of better-sqlite3: a single object, a depth counter
 * instead of a transaction per caller, a nested transaction is a savepoint, and every statement
 * takes a moment, so concurrent callers interleave unless something stops them.
 */
class FakeRunner implements GatedQueryRunner {
  isTransactionActive = false;
  depth = 0;
  log: string[] = [];
  failNextStart = false;
  failNextCommit = false;

  async query(sql: string): Promise<void> {
    await tick();
    this.log.push(sql);
  }

  async startTransaction(): Promise<void> {
    if (this.failNextStart) {
      this.failNextStart = false;
      throw new Error('database is locked');
    }
    this.isTransactionActive = true;
    await this.query(this.depth === 0 ? 'BEGIN' : `SAVEPOINT ${this.depth}`);
    this.depth += 1;
  }

  async commitTransaction(): Promise<void> {
    if (!this.isTransactionActive) throw new Error('no transaction');
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw new Error('disk full');
    }
    await this.query(this.depth > 1 ? `RELEASE ${this.depth - 1}` : 'COMMIT');
    this.depth -= 1;
    if (this.depth === 0) this.isTransactionActive = false;
  }

  async rollbackTransaction(): Promise<void> {
    if (!this.isTransactionActive) throw new Error('no transaction');
    await this.query(
      this.depth > 1 ? `ROLLBACK TO ${this.depth - 1}` : 'ROLLBACK',
    );
    this.depth -= 1;
    if (this.depth === 0) this.isTransactionActive = false;
  }
}

// What a repository does: a transaction around some statements
async function transaction(
  runner: FakeRunner,
  statements: string[],
  outcome: 'commit' | 'rollback' = 'commit',
): Promise<void> {
  await runner.startTransaction();
  for (const statement of statements) {
    await runner.query(statement);
  }
  await (outcome === 'commit'
    ? runner.commitTransaction()
    : runner.rollbackTransaction());
}

describe('transaction gate', () => {
  let runner: FakeRunner;

  beforeEach(() => {
    runner = new FakeRunner();
  });

  it('without it, concurrent transactions are tangled (the bug being fixed)', async () => {
    await Promise.all([
      inDatabaseScope(() => transaction(runner, ['A1', 'A2'])),
      inDatabaseScope(() => transaction(runner, ['B1', 'B2'])),
    ]);

    expect(runner.log).not.toEqual([
      'BEGIN',
      'A1',
      'A2',
      'COMMIT',
      'BEGIN',
      'B1',
      'B2',
      'COMMIT',
    ]);
  });

  it('lets one scope finish its transaction before another starts its own', async () => {
    gateQueryRunner(runner);

    await Promise.all([
      inDatabaseScope(() => transaction(runner, ['A1', 'A2'])),
      inDatabaseScope(() => transaction(runner, ['B1', 'B2'])),
    ]);

    expect(runner.log).toEqual([
      'BEGIN',
      'A1',
      'A2',
      'COMMIT',
      'BEGIN',
      'B1',
      'B2',
      'COMMIT',
    ]);
  });

  it('makes a query outside a transaction wait for the transaction in progress', async () => {
    gateQueryRunner(runner);

    await Promise.all([
      inDatabaseScope(() => transaction(runner, ['A1', 'A2'])),
      inDatabaseScope(async () => {
        await tick();
        await runner.query('READ');
      }),
    ]);

    expect(runner.log).toEqual(['BEGIN', 'A1', 'A2', 'COMMIT', 'READ']);
  });

  it("does not let one scope's rollback undo what another scope wrote", async () => {
    gateQueryRunner(runner);

    await Promise.all([
      inDatabaseScope(() => transaction(runner, ['A1'], 'rollback')),
      inDatabaseScope(() => transaction(runner, ['B1'], 'commit')),
    ]);

    expect(runner.log).toEqual([
      'BEGIN',
      'A1',
      'ROLLBACK',
      'BEGIN',
      'B1',
      'COMMIT',
    ]);
  });

  it('gives a nested transaction in the owning scope a savepoint instead of deadlocking', async () => {
    gateQueryRunner(runner);

    await inDatabaseScope(async () => {
      await runner.startTransaction();
      await runner.query('outer');
      await transaction(runner, ['inner']);
      await runner.commitTransaction();
    });

    expect(runner.log).toEqual([
      'BEGIN',
      'outer',
      'SAVEPOINT 1',
      'inner',
      'RELEASE 1',
      'COMMIT',
    ]);
  });

  it('runs a scope started inside another as the same scope', async () => {
    gateQueryRunner(runner);

    await inDatabaseScope(async () => {
      await runner.startTransaction();
      await inDatabaseScope(() => runner.query('from the child'));
      await runner.commitTransaction();
    });

    expect(runner.log).toEqual(['BEGIN', 'from the child', 'COMMIT']);
  });

  it("keeps the scope's own queries inside its transaction while it awaits something slow", async () => {
    gateQueryRunner(runner);

    await Promise.all([
      inDatabaseScope(async () => {
        await runner.startTransaction();
        await runner.query('A1');
        await new Promise((resolve) => setTimeout(resolve, 20));
        await runner.query('A2');
        await runner.commitTransaction();
      }),
      inDatabaseScope(() => transaction(runner, ['B1'])),
    ]);

    expect(runner.log).toEqual([
      'BEGIN',
      'A1',
      'A2',
      'COMMIT',
      'BEGIN',
      'B1',
      'COMMIT',
    ]);
  });

  it('reports a transaction as active only to the scope that owns it', async () => {
    gateQueryRunner(runner);
    const seen: Record<string, boolean> = {};

    await Promise.all([
      inDatabaseScope(async () => {
        await runner.startTransaction();
        seen['owner'] = runner.isTransactionActive;
        await tick();
        await tick();
        await runner.commitTransaction();
      }),
      inDatabaseScope(async () => {
        await tick();
        seen['other'] = runner.isTransactionActive;
      }),
    ]);

    expect(seen).toEqual({ owner: true, other: false });
  });

  it('lets go after a rollback, so the next scope is not stuck', async () => {
    gateQueryRunner(runner);

    await inDatabaseScope(() => transaction(runner, ['A1'], 'rollback'));
    await inDatabaseScope(() => runner.query('after'));

    expect(runner.log).toEqual(['BEGIN', 'A1', 'ROLLBACK', 'after']);
  });

  it('lets go when a transaction cannot even start', async () => {
    gateQueryRunner(runner);
    runner.failNextStart = true;

    await expect(
      inDatabaseScope(() => runner.startTransaction()),
    ).rejects.toThrow('database is locked');
    await inDatabaseScope(() => transaction(runner, ['B1']));

    expect(runner.log).toEqual(['BEGIN', 'B1', 'COMMIT']);
  });

  it('keeps the gate after a failed commit until the rollback that follows', async () => {
    gateQueryRunner(runner);
    runner.failNextCommit = true;
    const other = inDatabaseScope(async () => {
      await tick();
      await runner.query('other');
    });

    await inDatabaseScope(async () => {
      await runner.startTransaction();
      await runner.query('A1');
      await expect(runner.commitTransaction()).rejects.toThrow('disk full');
      await runner.rollbackTransaction();
    });
    await other;

    expect(runner.log).toEqual(['BEGIN', 'A1', 'ROLLBACK', 'other']);
  });

  it('passes a rollback with nothing to roll back straight to the driver', async () => {
    gateQueryRunner(runner);

    await expect(
      inDatabaseScope(() => runner.rollbackTransaction()),
    ).rejects.toThrow('no transaction');
    await inDatabaseScope(() => runner.query('after'));

    expect(runner.log).toEqual(['after']);
  });
});
