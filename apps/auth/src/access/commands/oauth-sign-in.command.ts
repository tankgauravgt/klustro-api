// import interfaces
import { OAuthProfile } from '../interfaces/oauth-profile.js';

export class OAuthSignInCommand {
  constructor(public readonly profile: OAuthProfile) {}
}
