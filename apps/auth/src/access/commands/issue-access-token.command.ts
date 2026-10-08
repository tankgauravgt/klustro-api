// import models
import type { User } from '../../identity/models/user.entity.js';

// Asks for a signed access token for a user who has just proven who they are
export class IssueAccessTokenCommand {
  constructor(public readonly user: User) {}
}
