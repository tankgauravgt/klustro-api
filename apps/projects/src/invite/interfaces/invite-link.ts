// import features
import type { ProjectRole } from '../../project/index.js';

export interface InviteLink {
  id: string;
  role: ProjectRole;
  inviteLink: string;
  expiresAt: Date;
}
