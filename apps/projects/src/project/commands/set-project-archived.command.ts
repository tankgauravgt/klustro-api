export class SetProjectArchivedCommand {
  constructor(
    public readonly userId: string,
    public readonly projectId: string,
    public readonly archived: boolean,
  ) {}
}
