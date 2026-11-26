import { Injectable, type NestMiddleware } from '@nestjs/common';

import { type NextFunction, type Request, type Response } from 'express';

import {
  isOauthRedirectPolicyOpen,
  isOauthRedirectUriAllowedByVeridian,
} from 'src/engine/core-modules/veridian-oauth/is-oauth-redirect-uri-allowed-by-veridian.util';

@Injectable()
export class VeridianOauthRedirectPolicyMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    if (isOauthRedirectPolicyOpen()) {
      return next();
    }

    const uris: unknown = req.body?.redirect_uris;

    const allAllowed =
      Array.isArray(uris) &&
      uris.length > 0 &&
      uris.every(
      (uri) =>
          typeof uri === 'string' && isOauthRedirectUriAllowedByVeridian(uri),
      );

    if (allAllowed) {
      return next();
    }

    res.status(400).json({
      error: 'invalid_redirect_uri',
      error_description:
        'redirect_uris must be loopback addresses (localhost, 127.0.0.1, [::1]) or the return address of a known assistant (Claude, ChatGPT)',
    });
  }
}
