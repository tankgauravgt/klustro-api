export class RemoveEmailCommand {
  constructor(
    public readonly userId: string,
    public readonly emailId: string,
  ) {}
}
