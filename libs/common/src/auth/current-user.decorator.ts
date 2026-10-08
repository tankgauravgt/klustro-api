import { createParamDecorator } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';

// The shape of `user` is set by each app's JwtStrategy; annotate it on the controller parameter
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): unknown => {
    return ctx.switchToHttp().getRequest<{ user: unknown }>().user;
  },
);
