// import features
import type { ProjectRole } from '../../project/index.js';

export interface MemberView {
  userId: string;
  role: ProjectRole;
  // Looked up from the auth service; null when it is unreachable or the account is gone
  username: string | null;
  displayName: string | null;
  joinedAt: Date;
  isYou: boolean;
}
