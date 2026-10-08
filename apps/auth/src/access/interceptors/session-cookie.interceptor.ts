import { CallHandler } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { NestInterceptor } from '@nestjs/common';
import { map } from 'rxjs';
import type { Response } from 'express';
import type { Observable } from 'rxjs';

// import application libraries
import { ACCESS_TOKEN_COOKIE } from '@libs/common';
import { SESSION_COOKIE_OPTIONS } from '@libs/common';

/*
 * Keeps the access token out of the response body. Handlers return `{ accessToken, ... }`; this
 * moves the token into the httpOnly session cookie so scripts in the page never see it.
 */
@Injectable()
export class SessionCookieInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((body: unknown) => {
        if (
          typeof body !== 'object' ||
          body === null ||
          !('accessToken' in body)
        ) {
          return body;
        }
        const { accessToken, ...rest } = body as { accessToken: string };
        response.cookie(
          ACCESS_TOKEN_COOKIE,
          accessToken,
          SESSION_COOKIE_OPTIONS,
        );
        return rest;
      }),
    );
  }
}
