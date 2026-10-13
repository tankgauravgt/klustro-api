import { IQueryHandler } from '@nestjs/cqrs';
import { QueryHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// import features
import { UserDirectoryService } from '../../../identity/index.js';
import { ProjectAccessService } from '../../../project/index.js';
import { ProjectMember } from '../../../project/index.js';

// import queries
import { ListMembersQuery } from '../list-members.query.js';

// import interfaces
import type { MemberView } from '../../interfaces/member-view.js';

@QueryHandler(ListMembersQuery)
export class ListMembersHandler implements IQueryHandler<
  ListMembersQuery,
  MemberView[]
> {
  constructor(
    @InjectRepository(ProjectMember)
    private readonly membersRepository: Repository<ProjectMember>,
    private readonly access: ProjectAccessService,
    private readonly directory: UserDirectoryService,
  ) {}

  async execute(query: ListMembersQuery): Promise<MemberView[]> {
    const { userId, projectId, authorization } = query;
    await this.access.requireMember(userId, projectId);

    const members = await this.membersRepository.find({
      where: { projectId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const cards = await this.directory.lookup(
      authorization,
      members.map((member) => member.userId),
    );
    return members.map((member) => ({
      userId: member.userId,
      username: cards.get(member.userId)?.username ?? null,
      displayName: cards.get(member.userId)?.displayName ?? null,
      role: member.role,
      joinedAt: member.createdAt,
      isYou: member.userId === userId,
    }));
  }
}
