// import features
import type { ProjectRole } from '../../project/index.js';

export interface InviteSummary {
  id: string;
  role: ProjectRole;
  createdByUserId: string;
  createdAt: Date;
  expiresAt: Date;
}

// What a link shows before it is accepted
export interface InvitePreview {
  projectName: string;
  meshProvider: string;
  memberCount: number;
  role: ProjectRole;
  expiresAt: Date;
  alreadyMember: boolean;
}
