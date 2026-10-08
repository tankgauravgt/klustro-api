// import interfaces
import { OAuthProfile } from '../../access/interfaces/oauth-profile.js';

export class ConnectOAuthCommand {
  constructor(
    public readonly userId: string,
    public readonly profile: OAuthProfile,
  ) {}
}
