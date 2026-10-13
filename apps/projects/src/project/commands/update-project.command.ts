export class UpdateProjectCommand {
  constructor(
    public readonly userId: string,
    public readonly projectId: string,
    public readonly name: string,
  ) {}
}
