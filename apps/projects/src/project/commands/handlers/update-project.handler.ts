import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// import commands
import { UpdateProjectCommand } from '../update-project.command.js';

// import services
import { ProjectAccessService } from '../../services/project-access.service.js';

// import models
import { ProjectMember } from '../../models/project-member.entity.js';
import { Project } from '../../models/project.entity.js';

// import interfaces
import type { ProjectSummary } from '../../interfaces/project-summary.js';

// import others
import { toProjectSummary } from '../../mappers/project-summary.mapper.js';

@CommandHandler(UpdateProjectCommand)
export class UpdateProjectHandler implements ICommandHandler<
  UpdateProjectCommand,
  ProjectSummary
> {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
  ) {}

  async execute(command: UpdateProjectCommand): Promise<ProjectSummary> {
    const { userId, projectId, name } = command;
    await this.access.requireOwner(userId, projectId, 'project.update');

    return this.dataSource.transaction(async (manager) => {
      const { project } = await this.access.requireOwner(
        userId,
        projectId,
        'project.update',
        manager,
      );
      this.access.assertActive(project);

      project.name = name;
      await manager.getRepository(Project).save(project);

      const memberCount = await manager
        .getRepository(ProjectMember)
        .countBy({ projectId });
      return toProjectSummary(project, 'owner', memberCount);
    });
  }
}
