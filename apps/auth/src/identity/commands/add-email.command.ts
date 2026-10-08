export class AddEmailCommand {
  constructor(
    public readonly userId: string,
    public readonly email: string,
  ) {}
}
