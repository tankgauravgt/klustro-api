// import models
import type { Project } from '../models/project.entity.js';

// import interfaces
import type { ProjectRole } from '../interfaces/project-role.js';
import type { ProjectSummary } from '../interfaces/project-summary.js';

export function toProjectSummary(
  project: Project,
  role: ProjectRole,
  memberCount: number,
): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    meshProvider: project.meshProvider,
    createdAt: project.createdAt,
    memberCount,
    role,
    archivedAt: project.archivedAt ?? null,
  };
}
