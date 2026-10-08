export class CreateInviteCommand {
  constructor(
    public readonly userId: string,
    public readonly projectId: string,
    public readonly expiresInMinutes: number,
  ) {}
}
