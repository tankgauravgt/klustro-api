export class ListAccountAuditLogsQuery {
  constructor(
    public readonly userId: string,
    public readonly limit: number,
    public readonly before?: number,
  ) {}
}
