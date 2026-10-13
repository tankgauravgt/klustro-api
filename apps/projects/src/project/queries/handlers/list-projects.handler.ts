import { IQueryHandler } from '@nestjs/cqrs';
import { QueryHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// import queries
import { ListProjectsQuery } from '../list-projects.query.js';

// import models
import { ProjectMember } from '../../models/project-member.entity.js';

// import interfaces
import type { ProjectPage } from '../../interfaces/project-page.js';

// import others
import { toProjectSummary } from '../../mappers/project-summary.mapper.js';

// LIKE treats % and _ as wildcards; the search text means them literally
const escapeLike = (text: string): string => text.replace(/[\\%_]/g, '\\$&');

@QueryHandler(ListProjectsQuery)
export class ListProjectsHandler implements IQueryHandler<
  ListProjectsQuery,
  ProjectPage
> {
  constructor(
    @InjectRepository(ProjectMember)
    private readonly membersRepository: Repository<ProjectMember>,
  ) {}

  async execute(query: ListProjectsQuery): Promise<ProjectPage> {
    const { userId, filter } = query;

    const matching = this.membersRepository
      .createQueryBuilder('member')
      .innerJoinAndSelect('member.project', 'project')
      .where('member.userId = :userId', { userId });
    if (filter.q) {
      matching.andWhere("LOWER(project.name) LIKE :q ESCAPE '\\'", {
        q: `%${escapeLike(filter.q.toLowerCase())}%`,
      });
    }
    if (filter.role) {
      matching.andWhere('member.role = :role', { role: filter.role });
    }
    if (filter.archived === 'exclude') {
      matching.andWhere('project.archivedAt IS NULL');
    } else if (filter.archived === 'only') {
      matching.andWhere('project.archivedAt IS NOT NULL');
    }

    const direction = filter.order === 'desc' ? 'DESC' : 'ASC';
    const total = await matching.getCount();
    const memberships = await matching
      .orderBy(
        filter.sort === 'name' ? 'LOWER(project.name)' : 'project.createdAt',
        direction,
      )
      .addOrderBy('project.id', direction)
      .offset(filter.offset)
      .limit(filter.limit)
      .getMany();
    if (memberships.length === 0) {
      return { items: [], total, limit: filter.limit, offset: filter.offset };
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

    return {
      items: memberships.map((membership) =>
        toProjectSummary(
          membership.project,
          membership.role,
          countByProject.get(membership.projectId) ?? 1,
        ),
      ),
      total,
      limit: filter.limit,
      offset: filter.offset,
    };
  }
}
