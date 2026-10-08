// import models
import { User } from '../../identity/models/user.entity.js';

// req.user shape after passing through JwtAuthGuard
export type RequestUser = User & {
  jti: string;
  exp: number;
};
