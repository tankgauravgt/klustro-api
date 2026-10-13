export class TransferOwnershipCommand {
  constructor(
    public readonly userId: string,
    public readonly projectId: string,
    public readonly targetUserId: string,
  ) {}
}
