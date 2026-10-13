export class ListProjectActivityQuery {
  constructor(
    public readonly userId: string,
    public readonly projectId: string,
    public readonly limit: number,
    public readonly before?: number,
  ) {}
}
