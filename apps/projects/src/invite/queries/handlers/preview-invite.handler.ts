import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { IQueryHandler } from '@nestjs/cqrs';
import { QueryHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// import features
import { Project } from '../../../project/index.js';
import { ProjectInvite } from '../../../project/index.js';
import { ProjectMember } from '../../../project/index.js';

// import queries
import { PreviewInviteQuery } from '../preview-invite.query.js';

// import interfaces
import type { InvitePreview } from '../../interfaces/invite-summary.js';

// import others
import { INVALID_INVITE_MESSAGE } from '../../pipes/invite-token.pipe.js';

@QueryHandler(PreviewInviteQuery)
export class PreviewInviteHandler implements IQueryHandler<
  PreviewInviteQuery,
  InvitePreview
> {
  constructor(
    @InjectRepository(ProjectInvite)
    private readonly invitesRepository: Repository<ProjectInvite>,
    @InjectRepository(ProjectMember)
    private readonly membersRepository: Repository<ProjectMember>,
    @InjectRepository(Project)
    private readonly projectsRepository: Repository<Project>,
  ) {}

  // Whoever holds the link may see this much of the project; nothing is changed
  async execute(query: PreviewInviteQuery): Promise<InvitePreview> {
    const { userId, token } = query;
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const invite = await this.invitesRepository.findOne({
      where: { tokenHash },
    });
    const project = invite
      ? await this.projectsRepository.findOneBy({ id: invite.projectId })
      : null;
    if (
      !invite ||
      !project ||
      project.archivedAt ||
      invite.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException(INVALID_INVITE_MESSAGE);
    }

    return {
      projectName: project.name,
      meshProvider: project.meshProvider,
      memberCount: await this.membersRepository.countBy({
        projectId: project.id,
      }),
      role: invite.role,
      expiresAt: invite.expiresAt,
      alreadyMember: await this.membersRepository.exists({
        where: { projectId: project.id, userId },
      }),
    };
  }
}
