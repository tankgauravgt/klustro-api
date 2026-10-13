// import others
import type { ProjectSummary } from './project-summary.js';

export interface ProjectPage {
  items: ProjectSummary[];
  total: number;
  limit: number;
  offset: number;
}
