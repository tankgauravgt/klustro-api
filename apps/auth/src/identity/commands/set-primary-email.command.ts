export class SetPrimaryEmailCommand {
  constructor(
    public readonly userId: string,
    public readonly emailId: string,
  ) {}
}
