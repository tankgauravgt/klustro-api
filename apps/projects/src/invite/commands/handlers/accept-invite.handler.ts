import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// import application libraries
import { AuditService } from '@libs/governance';

// import features
import { Project } from '../../../project/index.js';
import { ProjectInvite } from '../../../project/index.js';
import { ProjectMember } from '../../../project/index.js';
import { toProjectSummary } from '../../../project/index.js';
import type { ProjectSummary } from '../../../project/index.js';

// import commands
import { AcceptInviteCommand } from '../accept-invite.command.js';

@CommandHandler(AcceptInviteCommand)
export class AcceptInviteHandler implements ICommandHandler<
  AcceptInviteCommand,
  ProjectSummary
> {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async execute(command: AcceptInviteCommand): Promise<ProjectSummary> {
    const { userId, token } = command;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    let projectId = null as string | null;

    try {
      return await this.dataSource.transaction(async (manager) => {
        const invites = manager.getRepository(ProjectInvite);
        const members = manager.getRepository(ProjectMember);

        const invite = await invites.findOne({ where: { tokenHash } });
        if (!invite || invite.expiresAt.getTime() <= Date.now()) {
          throw new BadRequestException(
            'Invite link is invalid or has expired',
          );
        }
        projectId = invite.projectId;

        const project = await manager
          .getRepository(Project)
          .findOneByOrFail({ id: invite.projectId });
        if (project.archivedAt) {
          throw new ConflictException('Project is archived');
        }

        const alreadyMember = await members.exists({
          where: { projectId: invite.projectId, userId },
        });
        if (alreadyMember) {
          throw new ConflictException(
            'You are already a member of this project',
          );
        }

        // Invite links are single-use: soft-deleting it removes it from every lookup
        await invites.softRemove(invite);
        await members.save(
          members.create({
            projectId: invite.projectId,
            userId,
            role: invite.role,
          }),
        );

        const memberCount = await members.countBy({
          projectId: invite.projectId,
        });
        return toProjectSummary(project, invite.role, memberCount);
      });
    } catch (error) {
      // Recorded after the rollback, so the refusal itself is never lost
      if (error instanceof HttpException) {
        await this.audit.record({
          action: 'project.invite.accept',
          outcome: 'failure',
          scope: projectId ? `project:${projectId}` : null,
          metadata: { reason: error.message },
        });
      }
      throw error;
    }
  }
}
