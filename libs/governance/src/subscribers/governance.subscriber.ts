import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EntityMetadata } from 'typeorm';
import { EntitySubscriberInterface } from 'typeorm';
import { InsertEvent } from 'typeorm';
import { RecoverEvent } from 'typeorm';
import { RemoveEvent } from 'typeorm';
import { SoftRemoveEvent } from 'typeorm';
import { UpdateEvent } from 'typeorm';

// import services
import { AuditService } from '../services/audit.service.js';
import { RequestContextService } from '../services/request-context.service.js';

// import models
import { GovernedEntity } from '../models/governed.entity.js';

// import guards, decorators and strategies
import { getAuditedOptions } from '../decorators/audited.decorator.js';

const REDACTED = '[REDACTED]';
const NOISE_COLUMNS = ['updatedAt', 'updatedBy'];

/*
 * Captures every create, update, soft delete and restore made through the ORM
 * and writes the audit record inside the same transaction. Hard removal of a
 * governed record is refused outright.
 */
@Injectable()
export class GovernanceSubscriber implements EntitySubscriberInterface {
  constructor(
    @InjectDataSource() dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly context: RequestContextService,
  ) {
    dataSource.subscribers.push(this);
  }

  beforeInsert(event: InsertEvent<any>): void {
    if (event.entity instanceof GovernedEntity) {
      const actor = this.context.actorId();
      event.entity.createdBy ??= actor;
      event.entity.updatedBy = actor;
    }
  }

  beforeUpdate(event: UpdateEvent<any>): void {
    if (event.entity instanceof GovernedEntity) {
      event.entity.updatedBy = this.context.actorId();
    }
  }

  beforeRemove(event: RemoveEvent<any>): void {
    if (event.entity instanceof GovernedEntity) {
      throw new Error(
        `Hard delete of ${event.metadata.name} is forbidden; use softRemove`,
      );
    }
  }

  async afterInsert(event: InsertEvent<any>): Promise<void> {
    if (!this.isAudited(event.metadata)) return;
    await this.write(event, 'created', event.entity, {
      after: this.snapshot(event.metadata, event.entity),
    });
  }

  async afterUpdate(event: UpdateEvent<any>): Promise<void> {
    if (!this.isAudited(event.metadata) || !event.entity) return;

    const options = getAuditedOptions(event.metadata.target);
    const fields: Record<string, { from: unknown; to: unknown }> = {};
    for (const column of event.updatedColumns) {
      if (NOISE_COLUMNS.includes(column.propertyName)) continue;
      const redact = options?.redact?.includes(column.propertyName);
      fields[column.propertyName] = {
        from: redact ? REDACTED : column.getEntityValue(event.databaseEntity),
        to: redact ? REDACTED : column.getEntityValue(event.entity),
      };
    }
    if (Object.keys(fields).length === 0) return;

    await this.write(
      event,
      'updated',
      { ...event.databaseEntity, ...event.entity },
      { fields },
    );
  }

  async afterSoftRemove(event: SoftRemoveEvent<any>): Promise<void> {
    if (!this.isAudited(event.metadata) || !event.entity) return;

    await event.manager
      .createQueryBuilder()
      .update(event.metadata.target)
      .set({ deletedBy: this.context.actorId() })
      .where(event.metadata.getEntityIdMap(event.entity) ?? {})
      .callListeners(false)
      .execute();

    await this.write(event, 'deleted', event.entity, {
      before: this.snapshot(event.metadata, event.entity),
    });
  }

  async afterRecover(event: RecoverEvent<any>): Promise<void> {
    if (!this.isAudited(event.metadata) || !event.entity) return;
    await this.write(event, 'restored', event.entity, null);
  }

  private isAudited(metadata: EntityMetadata): boolean {
    return (
      typeof metadata.target === 'function' &&
      metadata.target.prototype instanceof GovernedEntity
    );
  }

  private snapshot(
    metadata: EntityMetadata,
    entity: Record<string, unknown>,
  ): Record<string, unknown> {
    const redact = getAuditedOptions(metadata.target)?.redact ?? [];
    return Object.fromEntries(
      metadata.columns
        .filter((column) => !NOISE_COLUMNS.includes(column.propertyName))
        .map((column) => [
          column.propertyName,
          redact.includes(column.propertyName)
            ? REDACTED
            : column.getEntityValue(entity),
        ]),
    );
  }

  private async write(
    event: { metadata: EntityMetadata; manager: InsertEvent<any>['manager'] },
    verb: string,
    entity: Record<string, unknown>,
    changes: Record<string, unknown> | null,
  ): Promise<void> {
    const options = getAuditedOptions(event.metadata.target);
    const entityType = options?.name ?? event.metadata.name;
    const idMap = event.metadata.getEntityIdMap(entity) ?? {};

    await this.audit.record(
      {
        action: `${entityType}.${verb}`,
        entityType,
        entityId: Object.values(idMap).join('|') || null,
        scope: options?.scope?.(entity) ?? null,
        changes,
      },
      event.manager,
    );
  }
}
