export class ListMembersQuery {
  constructor(
    public readonly userId: string,
    public readonly projectId: string,
    public readonly authorization?: string,
  ) {}
}
