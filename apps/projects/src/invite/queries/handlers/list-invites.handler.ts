import { IQueryHandler } from '@nestjs/cqrs';
import { QueryHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// import features
import { ProjectAccessService } from '../../../project/index.js';
import { ProjectInvite } from '../../../project/index.js';

// import queries
import { ListInvitesQuery } from '../list-invites.query.js';

// import interfaces
import type { InviteSummary } from '../../interfaces/invite-summary.js';

@QueryHandler(ListInvitesQuery)
export class ListInvitesHandler implements IQueryHandler<
  ListInvitesQuery,
  InviteSummary[]
> {
  constructor(
    @InjectRepository(ProjectInvite)
    private readonly invitesRepository: Repository<ProjectInvite>,
    private readonly access: ProjectAccessService,
  ) {}

  // Only invites that can still be accepted: used, revoked and expired ones are gone from the list
  async execute(query: ListInvitesQuery): Promise<InviteSummary[]> {
    const { userId, projectId } = query;
    await this.access.requireOwner(userId, projectId, 'project.invite.list');

    const invites = await this.invitesRepository.find({
      where: { projectId },
      order: { createdAt: 'DESC', id: 'ASC' },
    });
    return invites
      .filter((invite) => invite.expiresAt.getTime() > Date.now())
      .map((invite) => ({
        id: invite.id,
        role: invite.role,
        createdByUserId: invite.createdByUserId,
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt,
      }));
  }
}
