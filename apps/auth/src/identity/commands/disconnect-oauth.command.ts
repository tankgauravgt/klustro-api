// import models
import { OAuthProvider } from '../models/oauth-account.entity.js';

export class DisconnectOAuthCommand {
  constructor(
    public readonly userId: string,
    public readonly provider: OAuthProvider,
  ) {}
}
