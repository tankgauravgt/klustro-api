import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EntityManager } from 'typeorm';
import { LessThan } from 'typeorm';

// import application libraries
import { isDatabaseSerialized } from '@libs/common';

// import services
import { RequestContextService } from './request-context.service.js';

// import models
import { AuditLog } from '../models/audit-log.entity.js';

// import interfaces
import type { AuditEventInput } from '../interfaces/audit-event.js';
import type { AuditLogEntry } from '../interfaces/audit-log-entry.js';
import type { AuditLogPage } from '../interfaces/audit-log-entry.js';
import type { IntegrityReport } from '../interfaces/integrity-report.js';

// import others
import { GOVERNANCE_SERVICE } from '../constants.js';

const GENESIS_HASH = '0'.repeat(64);

const hashOf = (row: AuditLog): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        row.sequence,
        row.eventId,
        row.occurredAt,
        row.service,
        row.action,
        row.outcome,
        row.actorId,
        row.actorType,
        row.entityType,
        row.entityId,
        row.scope,
        row.changes,
        row.metadata,
        row.previousHash,
      ]),
    )
    .digest('hex');

@Injectable()
export class AuditService {
  // Appends are chained, so they are serialized within this process
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(GOVERNANCE_SERVICE) private readonly service: string,
    private readonly context: RequestContextService,
  ) {}

  /*
   * Pass the ambient `manager` to make the audit record commit or roll back
   * together with the change it describes. A failed append fails the request.
   */
  record(event: AuditEventInput, manager?: EntityManager): Promise<void> {
    // The database already makes work take turns, and queueing here as well could deadlock: a
    // record waiting for the one ahead of it, which waits for the transaction this one is in.
    // Reading the last link and adding the next must still be one unit.
    if (isDatabaseSerialized(this.dataSource)) {
      return manager
        ? this.append(event, manager)
        : this.dataSource.transaction((own) => this.append(event, own));
    }

    const run = this.tail.then(() =>
      this.append(event, manager ?? this.dataSource.manager),
    );
    this.tail = run.catch(() => undefined);
    return run;
  }

  async list(
    scope: string,
    limit: number,
    before?: number,
  ): Promise<AuditLogPage> {
    const rows = await this.dataSource.getRepository(AuditLog).find({
      where: before ? { scope, sequence: LessThan(before) } : { scope },
      order: { sequence: 'DESC' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => this.toEntry(row)),
      nextBefore: rows.length > limit ? page[page.length - 1].sequence : null,
    };
  }

  async verifyIntegrity(): Promise<IntegrityReport> {
    const rows = await this.dataSource
      .getRepository(AuditLog)
      .find({ order: { sequence: 'ASC' } });

    let previousHash = GENESIS_HASH;
    for (const [index, row] of rows.entries()) {
      const intact =
        row.sequence === index + 1 &&
        row.previousHash === previousHash &&
        row.hash === hashOf(row);
      if (!intact) {
        return { valid: false, checked: index, brokenAtSequence: row.sequence };
      }
      previousHash = row.hash;
    }
    return { valid: true, checked: rows.length, brokenAtSequence: null };
  }

  private async append(
    event: AuditEventInput,
    manager: EntityManager,
  ): Promise<void> {
    const repository = manager.getRepository(AuditLog);
    const [last] = await repository.find({
      order: { sequence: 'DESC' },
      take: 1,
    });

    const context = this.context.get();
    const actorId = event.actorId ?? context?.actorId ?? null;
    const row = repository.create({
      sequence: (last?.sequence ?? 0) + 1,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      service: this.service,
      action: event.action,
      outcome: event.outcome ?? 'success',
      actorId,
      actorType: actorId ? 'user' : context ? 'anonymous' : 'system',
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
      scope: event.scope ?? null,
      changes: event.changes ? JSON.stringify(event.changes) : null,
      metadata: JSON.stringify({
        requestId: context?.requestId ?? null,
        ip: context?.ip ?? null,
        peerIp: context?.peerIp ?? null,
        forwardedFor: context?.forwardedFor ?? null,
        userAgent: context?.userAgent ?? null,
        operation: context?.operation ?? null,
        ...event.metadata,
      }),
      previousHash: last?.hash ?? GENESIS_HASH,
    });
    row.hash = hashOf(row);

    await repository.insert(row);
  }

  private toEntry(row: AuditLog): AuditLogEntry {
    return {
      sequence: row.sequence,
      eventId: row.eventId,
      occurredAt: row.occurredAt,
      service: row.service,
      action: row.action,
      outcome: row.outcome,
      actorId: row.actorId,
      actorType: row.actorType,
      entityType: row.entityType,
      entityId: row.entityId,
      scope: row.scope,
      changes: row.changes ? JSON.parse(row.changes) : null,
      metadata: JSON.parse(row.metadata),
      hash: row.hash,
    };
  }
}
