export class ResendEmailVerificationCommand {
  constructor(
    public readonly userId: string,
    public readonly emailId: string,
  ) {}
}
