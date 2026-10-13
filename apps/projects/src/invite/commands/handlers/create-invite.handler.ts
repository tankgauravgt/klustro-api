import { createHash } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// import application libraries
import { AppConfigService } from '@libs/common';

// import features
import { ProjectAccessService } from '../../../project/index.js';
import { ProjectInvite } from '../../../project/index.js';

// import commands
import { CreateInviteCommand } from '../create-invite.command.js';

// import interfaces
import type { InviteLink } from '../../interfaces/invite-link.js';

@CommandHandler(CreateInviteCommand)
export class CreateInviteHandler implements ICommandHandler<
  CreateInviteCommand,
  InviteLink
> {
  constructor(
    @InjectRepository(ProjectInvite)
    private readonly invitesRepository: Repository<ProjectInvite>,
    private readonly access: ProjectAccessService,
    private readonly config: AppConfigService,
  ) {}

  async execute(command: CreateInviteCommand): Promise<InviteLink> {
    const { userId, projectId, expiresInMinutes, role } = command;

    const { project } = await this.access.requireOwner(
      userId,
      projectId,
      'project.invite.create',
    );
    this.access.assertActive(project);

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
    const invite = await this.invitesRepository.save(
      this.invitesRepository.create({
        projectId,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        createdByUserId: userId,
        role,
        expiresAt,
      }),
    );

    return {
      id: invite.id,
      role,
      inviteLink: `${this.config.get('WEB_URL').replace(/\/+$/, '')}/invite/${token}`,
      expiresAt,
    };
  }
}
