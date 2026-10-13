export class RevokeInviteCommand {
  constructor(
    public readonly userId: string,
    public readonly projectId: string,
    public readonly inviteId: string,
  ) {}
}
