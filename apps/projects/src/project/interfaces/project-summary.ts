// import others
import type { MeshProvider } from './mesh-provider.js';
import type { ProjectRole } from './project-role.js';

export interface ProjectSummary {
  id: string;
  name: string;
  meshProvider: MeshProvider;
  createdAt: Date;
  memberCount: number;
  role: ProjectRole;
}
