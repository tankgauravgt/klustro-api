// import features
import type { ProjectRole } from '../../project/index.js';

export class ChangeMemberRoleCommand {
  constructor(
    public readonly userId: string,
    public readonly projectId: string,
    public readonly targetUserId: string,
    public readonly role: ProjectRole,
  ) {}
}
