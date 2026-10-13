export class GetProjectQuery {
  constructor(
    public readonly userId: string,
    public readonly projectId: string,
  ) {}
}
