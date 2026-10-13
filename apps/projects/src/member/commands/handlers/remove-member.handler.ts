import { BadRequestException } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// import features
import { ProjectAccessService } from '../../../project/index.js';
import { ProjectMember } from '../../../project/index.js';

// import commands
import { RemoveMemberCommand } from '../remove-member.command.js';

@CommandHandler(RemoveMemberCommand)
export class RemoveMemberHandler implements ICommandHandler<
  RemoveMemberCommand,
  void
> {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
  ) {}

  async execute(command: RemoveMemberCommand): Promise<void> {
    const { userId, projectId, targetUserId } = command;
    await this.access.requireOwner(userId, projectId, 'project.member.remove');
    if (targetUserId === userId) {
      throw new BadRequestException('Use leave to remove yourself');
    }

    await this.dataSource.transaction(async (manager) => {
      const { project } = await this.access.requireOwner(
        userId,
        projectId,
        'project.member.remove',
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
      await members.softRemove(target);
    });
  }
}
