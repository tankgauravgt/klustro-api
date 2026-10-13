export class ListInvitesQuery {
  constructor(
    public readonly userId: string,
    public readonly projectId: string,
  ) {}
}
