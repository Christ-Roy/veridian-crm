import {
  type RawBodyRequest,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { type Request, type Response } from 'express';

import { ThrottlerException } from 'src/engine/core-modules/throttler/throttler.exception';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { VeridianHubSsoService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service';
import { isHubSignatureValid } from 'src/engine/core-modules/veridian-hub-sso/utils/is-hub-signature-valid.util';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';

const readHeader = (request: Request, name: string): string | undefined => {
  const value = request.headers[name];

  return Array.isArray(value) ? value[0] : value;
};

// Hub bounce, CONTRAT-HUB §6bis.8.3. Authentication is the HMAC, hence the public guards.
@Controller()
@UseGuards(PublicEndpointGuard, NoPermissionGuard)
export class VeridianHubSsoController {
  constructor(
    private readonly veridianHubSsoService: VeridianHubSsoService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  @Post('api/sso/issue-magic-link')
  async issueMagicLink(
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    const secrets = [
      process.env.HUB_API_SECRET,
      process.env.HUB_API_SECRET_NEXT,
    ].filter(isNonEmptyString);

    if (secrets.length === 0) {
      return response.status(503).json({ error: 'hub_sso_not_configured' });
    }

    const isSigned = isHubSignatureValid({
      rawBody: request.rawBody,
      timestamp: readHeader(request, 'x-veridian-timestamp'),
      signature: readHeader(request, 'x-veridian-hub-signature'),
      secrets,
    });

    if (!isSigned) {
      return response.status(401).json({ error: 'invalid_signature' });
    }

    const email = request.body?.email;

    if (!isNonEmptyString(email) || !isNonEmptyString(request.body?.hub_user_id)) {
      return response.status(400).json({ error: 'invalid_body' });
    }

    try {
      const magicLinkUrl =
        await this.veridianHubSsoService.issueMagicLinkUrl(email);

      if (!magicLinkUrl) {
        return response.status(400).json({
          error: 'user_not_in_app',
          hint: 'no workspace for this hub_user_id',
        });
      }

      return response.status(200).json({ magic_link_url: magicLinkUrl });
    } catch (error) {
      if (error instanceof ThrottlerException) {
        return response.status(429).json({ error: 'rate_limited' });
      }

      throw error;
    }
  }

  @Get('auth/token')
  async followMagicLink(@Query('t') token: string, @Res() response: Response) {
    const redirectUrl = isNonEmptyString(token)
      ? await this.veridianHubSsoService.resolveRedirectUrl(token)
      : null;

    return response.redirect(
      redirectUrl ?? this.twentyConfigService.get('FRONTEND_URL') ?? this.twentyConfigService.get('SERVER_URL'),
    );
  }
}
