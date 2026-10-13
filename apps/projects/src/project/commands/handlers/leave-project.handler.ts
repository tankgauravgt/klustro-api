import { NotFoundException } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// import commands
import { LeaveProjectCommand } from '../leave-project.command.js';

// import models
import { ProjectInvite } from '../../models/project-invite.entity.js';
import { ProjectMember } from '../../models/project-member.entity.js';
import { Project } from '../../models/project.entity.js';

@CommandHandler(LeaveProjectCommand)
export class LeaveProjectHandler implements ICommandHandler<
  LeaveProjectCommand,
  void
> {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  execute(command: LeaveProjectCommand): Promise<void> {
    const { userId, projectId } = command;

    return this.dataSource.transaction(async (manager) => {
      const members = manager.getRepository(ProjectMember);

      const leaving = await members.findOne({ where: { projectId, userId } });
      if (!leaving) {
        throw new NotFoundException('Project not found');
      }
      await members.softRemove(leaving);

      const remaining = await members.find({
        where: { projectId },
        order: { createdAt: 'ASC', id: 'ASC' },
      });

      // Last member out: the project and its open invites are soft-deleted with them
      if (remaining.length === 0) {
        const invites = manager.getRepository(ProjectInvite);
        // One at a time, so their audit records are appended in turn
        for (const invite of await invites.find({ where: { projectId } })) {
          await invites.softRemove(invite);
        }

        const projects = manager.getRepository(Project);
        await projects.softRemove(
          await projects.findOneByOrFail({ id: projectId }),
        );
        return;
      }

      // Never leave a project without an owner: promote the longest-standing member
      const hasOwner = remaining.some((member) => member.role === 'owner');
      if (!hasOwner) {
        remaining[0].role = 'owner';
        await members.save(remaining[0]);
      }
    });
  }
}
