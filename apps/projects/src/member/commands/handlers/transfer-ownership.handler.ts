import { BadRequestException } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// import features
import { ProjectAccessService } from '../../../project/index.js';
import { ProjectMember } from '../../../project/index.js';
import { toProjectSummary } from '../../../project/index.js';
import type { ProjectSummary } from '../../../project/index.js';

// import commands
import { TransferOwnershipCommand } from '../transfer-ownership.command.js';

@CommandHandler(TransferOwnershipCommand)
export class TransferOwnershipHandler implements ICommandHandler<
  TransferOwnershipCommand,
  ProjectSummary
> {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
  ) {}

  // The caller hands the project over: the target becomes an owner and the caller a plain member
  async execute(command: TransferOwnershipCommand): Promise<ProjectSummary> {
    const { userId, projectId, targetUserId } = command;
    await this.access.requireOwner(userId, projectId, 'project.transfer');
    if (targetUserId === userId) {
      throw new BadRequestException('You already own this project');
    }

    return this.dataSource.transaction(async (manager) => {
      const { project, membership } = await this.access.requireOwner(
        userId,
        projectId,
        'project.transfer',
        manager,
      );
      this.access.assertActive(project);

      const members = manager.getRepository(ProjectMember);
      const target = await members.findOne({
        where: { projectId, userId: targetUserId },
      });
      if (!target) {
        throw new NotFoundException('Member not found');
      }
      if (target.role === 'owner') {
        throw new ConflictException('That member is already an owner');
      }

      target.role = 'owner';
      await members.save(target);
      membership.role = 'member';
      await members.save(membership);

      const memberCount = await members.countBy({ projectId });
      return toProjectSummary(project, 'member', memberCount);
    });
  }
}
