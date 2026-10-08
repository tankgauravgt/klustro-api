export class LeaveProjectCommand {
  constructor(
    public readonly userId: string,
    public readonly projectId: string,
  ) {}
}
