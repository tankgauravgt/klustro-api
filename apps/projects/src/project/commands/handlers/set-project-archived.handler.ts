import { ConflictException } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// import commands
import { SetProjectArchivedCommand } from '../set-project-archived.command.js';

// import services
import { ProjectAccessService } from '../../services/project-access.service.js';

// import models
import { ProjectMember } from '../../models/project-member.entity.js';
import { Project } from '../../models/project.entity.js';

// import interfaces
import type { ProjectSummary } from '../../interfaces/project-summary.js';

// import others
import { toProjectSummary } from '../../mappers/project-summary.mapper.js';

@CommandHandler(SetProjectArchivedCommand)
export class SetProjectArchivedHandler implements ICommandHandler<
  SetProjectArchivedCommand,
  ProjectSummary
> {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
  ) {}

  async execute(command: SetProjectArchivedCommand): Promise<ProjectSummary> {
    const { userId, projectId, archived } = command;
    const action = archived ? 'project.archive' : 'project.unarchive';
    await this.access.requireOwner(userId, projectId, action);

    return this.dataSource.transaction(async (manager) => {
      const { project } = await this.access.requireOwner(
        userId,
        projectId,
        action,
        manager,
      );
      if (Boolean(project.archivedAt) === archived) {
        throw new ConflictException(
          archived ? 'Project is already archived' : 'Project is not archived',
        );
      }

      project.archivedAt = archived ? new Date() : null;
      await manager.getRepository(Project).save(project);

      const memberCount = await manager
        .getRepository(ProjectMember)
        .countBy({ projectId });
      return toProjectSummary(project, 'owner', memberCount);
    });
  }
}
