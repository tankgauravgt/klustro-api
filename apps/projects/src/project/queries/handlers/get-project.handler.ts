import { IQueryHandler } from '@nestjs/cqrs';
import { QueryHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// import queries
import { GetProjectQuery } from '../get-project.query.js';

// import services
import { ProjectAccessService } from '../../services/project-access.service.js';

// import models
import { ProjectMember } from '../../models/project-member.entity.js';

// import interfaces
import type { ProjectSummary } from '../../interfaces/project-summary.js';

// import others
import { toProjectSummary } from '../../mappers/project-summary.mapper.js';

@QueryHandler(GetProjectQuery)
export class GetProjectHandler implements IQueryHandler<
  GetProjectQuery,
  ProjectSummary
> {
  constructor(
    @InjectRepository(ProjectMember)
    private readonly membersRepository: Repository<ProjectMember>,
    private readonly access: ProjectAccessService,
  ) {}

  async execute(query: GetProjectQuery): Promise<ProjectSummary> {
    const { userId, projectId } = query;
    const { project, membership } = await this.access.requireMember(
      userId,
      projectId,
    );
    const memberCount = await this.membersRepository.countBy({ projectId });
    return toProjectSummary(project, membership.role, memberCount);
  }
}
