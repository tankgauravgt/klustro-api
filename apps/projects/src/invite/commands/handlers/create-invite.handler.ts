import { createHash } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// import application libraries
import { AppConfigService } from '@libs/common';
import { AuditService } from '@libs/governance';

// import features
import { ProjectInvite } from '../../../project/index.js';
import { ProjectMember } from '../../../project/index.js';

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
    @InjectRepository(ProjectMember)
    private readonly membersRepository: Repository<ProjectMember>,
    @InjectRepository(ProjectInvite)
    private readonly invitesRepository: Repository<ProjectInvite>,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  async execute(command: CreateInviteCommand): Promise<InviteLink> {
    const { userId, projectId, expiresInMinutes } = command;

    const membership = await this.membersRepository.findOne({
      where: { projectId, userId },
    });
    if (!membership) {
      await this.audit.record({
        action: 'project.invite.create',
        outcome: 'denied',
        entityType: 'project',
        entityId: projectId,
        metadata: { reason: 'not_a_member' },
      });
      throw new NotFoundException('Project not found');
    }
    if (membership.role !== 'owner') {
      await this.audit.record({
        action: 'project.invite.create',
        outcome: 'denied',
        entityType: 'project',
        entityId: projectId,
        scope: `project:${projectId}`,
        metadata: { reason: 'not_an_owner' },
      });
      throw new ForbiddenException('Only project owners can create invites');
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
    await this.invitesRepository.save(
      this.invitesRepository.create({
        projectId,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        createdByUserId: userId,
        expiresAt,
      }),
    );

    return {
      inviteLink: `${this.config.get('WEB_URL').replace(/\/+$/, '')}/invite/${token}`,
      expiresAt,
    };
  }
}
