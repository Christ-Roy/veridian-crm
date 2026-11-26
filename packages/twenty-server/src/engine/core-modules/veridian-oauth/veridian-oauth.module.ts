import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';

import { ApiPath } from 'twenty-shared/types';

import { VeridianOauthRedirectPolicyMiddleware } from 'src/engine/core-modules/veridian-oauth/veridian-oauth-redirect-policy.middleware';

// Dynamic registration (POST /oauth/register) stays public, but a client can only
// register loopback or known-assistant redirect URIs. VERIDIAN_OAUTH_REDIRECT_POLICY=open
// restores the upstream behavior.
@Module({
  providers: [VeridianOauthRedirectPolicyMiddleware],
})
export class VeridianOauthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(VeridianOauthRedirectPolicyMiddleware).forRoutes({
      path: `${ApiPath.OAuth}/register`,
      method: RequestMethod.POST,
    });
  }
}
