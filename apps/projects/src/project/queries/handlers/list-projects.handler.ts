import { IQueryHandler } from '@nestjs/cqrs';
import { QueryHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// import queries
import { ListProjectsQuery } from '../list-projects.query.js';

// import models
import { ProjectMember } from '../../models/project-member.entity.js';

// import interfaces
import type { ProjectSummary } from '../../interfaces/project-summary.js';

// import others
import { toProjectSummary } from '../../mappers/project-summary.mapper.js';

@QueryHandler(ListProjectsQuery)
export class ListProjectsHandler implements IQueryHandler<
  ListProjectsQuery,
  ProjectSummary[]
> {
  constructor(
    @InjectRepository(ProjectMember)
    private readonly membersRepository: Repository<ProjectMember>,
  ) {}

  async execute(query: ListProjectsQuery): Promise<ProjectSummary[]> {
    const memberships = await this.membersRepository.find({
      where: { userId: query.userId },
      relations: { project: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    if (memberships.length === 0) {
      return [];
    }

    const counts = await this.membersRepository
      .createQueryBuilder('member')
      .select('member.projectId', 'projectId')
      .addSelect('COUNT(*)', 'count')
      .where('member.projectId IN (:...projectIds)', {
        projectIds: memberships.map((membership) => membership.projectId),
      })
      .groupBy('member.projectId')
      .getRawMany<{ projectId: string; count: string }>();
    const countByProject = new Map(
      counts.map((row) => [row.projectId, Number(row.count)]),
    );

    return memberships.map((membership) =>
      toProjectSummary(
        membership.project,
        membership.role,
        countByProject.get(membership.projectId) ?? 1,
      ),
    );
  }
}
