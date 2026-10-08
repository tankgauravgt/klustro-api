export class LogoutCommand {
  constructor(
    public readonly jti: string,
    public readonly expiresAt: Date,
  ) {}
}
