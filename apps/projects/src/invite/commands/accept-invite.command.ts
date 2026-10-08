export class AcceptInviteCommand {
  constructor(
    public readonly userId: string,
    public readonly token: string,
  ) {}
}
