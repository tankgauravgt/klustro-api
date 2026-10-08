// import models
import { OAuthProvider } from '../../identity/models/oauth-account.entity.js';

export interface OAuthProfile {
  provider: OAuthProvider;
  providerAccountId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}
