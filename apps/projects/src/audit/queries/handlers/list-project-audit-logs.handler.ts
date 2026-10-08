import { ForbiddenException } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { IQueryHandler } from '@nestjs/cqrs';
import { QueryHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// import application libraries
import { AuditService } from '@libs/governance';
import type { AuditLogPage } from '@libs/governance';

// import features
import { ProjectMember } from '../../../project/index.js';

// import queries
import { ListProjectAuditLogsQuery } from '../list-project-audit-logs.query.js';

@QueryHandler(ListProjectAuditLogsQuery)
export class ListProjectAuditLogsHandler implements IQueryHandler<
  ListProjectAuditLogsQuery,
  AuditLogPage
> {
  constructor(
    @InjectRepository(ProjectMember)
    private readonly membersRepository: Repository<ProjectMember>,
    private readonly audit: AuditService,
  ) {}

  async execute(query: ListProjectAuditLogsQuery): Promise<AuditLogPage> {
    const { userId, projectId, limit, before } = query;

    const membership = await this.membersRepository.findOne({
      where: { projectId, userId },
    });
    if (!membership) {
      throw new NotFoundException('Project not found');
    }
    if (membership.role !== 'owner') {
      throw new ForbiddenException(
        'Only project owners can read the audit log',
      );
    }

    return this.audit.list(`project:${projectId}`, limit, before);
  }
}
