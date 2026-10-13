export class VerifyProjectAuditQuery {
  constructor(
    public readonly userId: string,
    public readonly projectId: string,
  ) {}
}
