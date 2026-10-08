import { Injectable } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';

// import application libraries
import { OUTBOUND_REQUEST_TIMEOUT_MS } from '@libs/common';

// import features
import { OAuthProfile } from '../../../interfaces/oauth-profile.js';

interface GithubUser {
  id: number;
  name: string | null;
}

interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

const GITHUB_API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'klustro-backend',
};

/*
 * Verifies a GitHub access token by asking GitHub's API who it belongs to. Only call it with a
 * token this server got itself by trading an authorization code with its client secret: GitHub tokens carry no audience that could
 * be checked here, so a token handed in by a client could have been issued to any other app.
 */
@Injectable()
export class GithubTokenVerifierService {
  async verify(accessToken: string): Promise<OAuthProfile> {
    const authHeaders = {
      ...GITHUB_API_HEADERS,
      Authorization: `Bearer ${accessToken}`,
    };

    const userResponse = await fetch('https://api.github.com/user', {
      headers: authHeaders,
      signal: AbortSignal.timeout(OUTBOUND_REQUEST_TIMEOUT_MS),
    });
    if (!userResponse.ok) {
      throw new UnauthorizedException('Invalid GitHub access token');
    }
    const user = (await userResponse.json()) as GithubUser;

    const emailsResponse = await fetch('https://api.github.com/user/emails', {
      headers: authHeaders,
      signal: AbortSignal.timeout(OUTBOUND_REQUEST_TIMEOUT_MS),
    });
    if (!emailsResponse.ok) {
      throw new UnauthorizedException('Unable to fetch GitHub account email');
    }
    const emails = (await emailsResponse.json()) as GithubEmail[];

    const primaryEmail =
      emails.find((e) => e.primary && e.verified) ??
      emails.find((e) => e.verified);
    if (!primaryEmail) {
      throw new UnauthorizedException('GitHub account has no verified email');
    }

    const [firstName, ...rest] = (user.name ?? '').split(' ');

    return {
      provider: 'github',
      providerAccountId: String(user.id),
      email: primaryEmail.email,
      firstName: firstName || null,
      lastName: rest.length > 0 ? rest.join(' ') : null,
    };
  }
}
