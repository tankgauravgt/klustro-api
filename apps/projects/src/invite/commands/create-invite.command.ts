// import features
import type { ProjectRole } from '../../project/index.js';

export class CreateInviteCommand {
  constructor(
    public readonly userId: string,
    public readonly projectId: string,
    public readonly expiresInMinutes: number,
    public readonly role: ProjectRole = 'member',
  ) {}
}
