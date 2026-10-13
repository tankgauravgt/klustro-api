import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// import commands
import { DeleteProjectCommand } from '../delete-project.command.js';

// import services
import { ProjectAccessService } from '../../services/project-access.service.js';

// import models
import { ProjectInvite } from '../../models/project-invite.entity.js';
import { ProjectMember } from '../../models/project-member.entity.js';
import { Project } from '../../models/project.entity.js';

@CommandHandler(DeleteProjectCommand)
export class DeleteProjectHandler implements ICommandHandler<
  DeleteProjectCommand,
  void
> {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
  ) {}

  async execute(command: DeleteProjectCommand): Promise<void> {
    const { userId, projectId } = command;
    await this.access.requireOwner(userId, projectId, 'project.delete');

    await this.dataSource.transaction(async (manager) => {
      const { project } = await this.access.requireOwner(
        userId,
        projectId,
        'project.delete',
        manager,
      );

      const invites = manager.getRepository(ProjectInvite);
      // One at a time: removing several together would append their audit records concurrently,
      // and two of them would read the same last link of the chain
      for (const invite of await invites.find({ where: { projectId } })) {
        await invites.softRemove(invite);
      }
      const members = manager.getRepository(ProjectMember);
      for (const member of await members.find({ where: { projectId } })) {
        await members.softRemove(member);
      }
      await manager.getRepository(Project).softRemove(project);
    });
  }
}
