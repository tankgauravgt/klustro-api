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

// import commands
import { ChangeMemberRoleCommand } from '../change-member-role.command.js';

// import interfaces
import type { MemberView } from '../../interfaces/member-view.js';

@CommandHandler(ChangeMemberRoleCommand)
export class ChangeMemberRoleHandler implements ICommandHandler<
  ChangeMemberRoleCommand,
  MemberView
> {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
  ) {}

  async execute(command: ChangeMemberRoleCommand): Promise<MemberView> {
    const { userId, projectId, targetUserId, role } = command;
    await this.access.requireOwner(userId, projectId, 'project.member.update');
    // Nobody sets their own role: an owner steps down by handing the project over, a member is made
    // an owner by an owner. Either way someone else decides.
    if (targetUserId === userId) {
      throw new BadRequestException(
        'You cannot change your own role; transfer ownership or ask another owner',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const { project } = await this.access.requireOwner(
        userId,
        projectId,
        'project.member.update',
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

      if (target.role !== role) {
        // A project always keeps an owner: demoting the last one is refused
        if (target.role === 'owner') {
          const owners = await members.countBy({ projectId, role: 'owner' });
          if (owners <= 1) {
            throw new ConflictException(
              'A project needs at least one owner; transfer ownership first',
            );
          }
        }
        target.role = role;
        await members.save(target);
      }

      return {
        userId: target.userId,
        username: null,
        displayName: null,
        role: target.role,
        joinedAt: target.createdAt,
        isYou: target.userId === userId,
      };
    });
  }
}
