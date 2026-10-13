import { IQueryHandler } from '@nestjs/cqrs';
import { QueryHandler } from '@nestjs/cqrs';

// import application libraries
import { AuditService } from '@libs/governance';

// import features
import { ProjectAccessService } from '../../../project/index.js';

// import queries
import { ListProjectActivityQuery } from '../list-project-activity.query.js';

// import interfaces
import type { ActivityPage } from '../../interfaces/activity.js';

@QueryHandler(ListProjectActivityQuery)
export class ListProjectActivityHandler implements IQueryHandler<
  ListProjectActivityQuery,
  ActivityPage
> {
  constructor(
    private readonly access: ProjectAccessService,
    private readonly audit: AuditService,
  ) {}

  /*
   * The audit trail without its details: no before/after values, IP addresses or user agents, and
   * no refused attempts. Pages are cut before the filter, so one can be shorter than the limit.
   */
  async execute(query: ListProjectActivityQuery): Promise<ActivityPage> {
    const { userId, projectId, limit, before } = query;
    await this.access.requireMember(userId, projectId);

    const page = await this.audit.list(`project:${projectId}`, limit, before);
    return {
      items: page.items
        .filter((entry) => entry.outcome === 'success')
        .map((entry) => ({
          sequence: entry.sequence,
          occurredAt: entry.occurredAt,
          action: entry.action,
          actorId: entry.actorId,
          entityType: entry.entityType,
          entityId: entry.entityId,
        })),
      nextBefore: page.nextBefore,
    };
  }
}
