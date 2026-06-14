/*
 * Veridian CRM — module SSO clean-room (AGPLv3).
 *
 * Endpoints REST du login SSO (hors GraphQL, comme les controllers OAuth natifs) :
 *   GET  /auth/sso/:providerId/login     → redirige vers l'IdP
 *   POST /auth/sso/:providerId/acs       → ACS SAML (HTTP-POST binding)
 *   GET  /auth/sso/:providerId/callback  → callback OIDC (Authorization Code)
 *
 * Aucun guard d'auth : ce sont des endpoints publics non authentifiés (le user
 * n'est pas encore loggé). On réutilise PublicEndpointGuard + NoPermissionGuard
 * comme les controllers OAuth AGPL.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';

import { type Request, type Response } from 'express';

import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { VeridianOidcService } from 'src/engine/core-modules/veridian-sso/services/veridian-oidc.service';
import { VeridianSamlService } from 'src/engine/core-modules/veridian-sso/services/veridian-saml.service';
import { VeridianSsoAuthService } from 'src/engine/core-modules/veridian-sso/services/veridian-sso-auth.service';
import { VeridianSsoProviderService } from 'src/engine/core-modules/veridian-sso/services/veridian-sso-provider.service';
import { VeridianSsoProviderType } from 'src/engine/core-modules/veridian-sso/enums/veridian-sso-provider-type.enum';
import {
  generateRandomToken,
  OIDC_FLOW_COOKIE,
  OIDC_FLOW_TTL_MS,
  parseOidcFlowState,
  serializeOidcFlowState,
} from 'src/engine/core-modules/veridian-sso/utils/oidc-flow-state.util';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';

@Controller('auth/sso')
@UseGuards(PublicEndpointGuard, NoPermissionGuard)
export class VeridianSsoController {
  constructor(
    private readonly providerService: VeridianSsoProviderService,
    private readonly samlService: VeridianSamlService,
    private readonly oidcService: VeridianOidcService,
    private readonly ssoAuthService: VeridianSsoAuthService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  @Get(':providerId/login')
  async login(
    @Param('providerId') providerId: string,
    @Res() res: Response,
  ): Promise<void> {
    const provider =
      await this.providerService.findEnabledByIdOrThrow(providerId);

    if (provider.type === VeridianSsoProviderType.SAML) {
      const config = this.providerService.getDecryptedSamlConfig(provider);
      const url = await this.samlService.getLoginUrl(
        config,
        this.buildAcsUrl(providerId),
        providerId,
      );

      res.redirect(url);

      return;
    }

    const config = this.providerService.getDecryptedOidcConfig(provider);
    const state = generateRandomToken();
    const nonce = generateRandomToken();

    const url = await this.oidcService.getAuthorizationUrl(
      config,
      this.buildCallbackUrl(providerId),
      state,
      nonce,
    );

    res.cookie(
      OIDC_FLOW_COOKIE,
      serializeOidcFlowState(
        { providerId, state, nonce, issuedAt: Date.now() },
        this.getAppSecret(),
      ),
      {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: OIDC_FLOW_TTL_MS,
        path: '/auth/sso',
      },
    );

    res.redirect(url);
  }

  @Post(':providerId/acs')
  async samlAcs(
    @Param('providerId') providerId: string,
    @Body('SAMLResponse') samlResponse: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!samlResponse) {
      throw new BadRequestException('Missing SAMLResponse');
    }

    const provider =
      await this.providerService.findEnabledByIdOrThrow(providerId);

    if (provider.type !== VeridianSsoProviderType.SAML) {
      throw new BadRequestException('Provider is not SAML');
    }

    const config = this.providerService.getDecryptedSamlConfig(provider);

    const identity = await this.samlService.validateResponse(
      config,
      this.buildAcsUrl(providerId),
      samlResponse,
    );

    const redirectUrl = await this.ssoAuthService.completeSignIn(
      identity,
      provider.workspaceId,
    );

    res.redirect(redirectUrl);
  }

  @Get(':providerId/callback')
  async oidcCallback(
    @Param('providerId') providerId: string,
    @Query() query: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const provider =
      await this.providerService.findEnabledByIdOrThrow(providerId);

    if (provider.type !== VeridianSsoProviderType.OIDC) {
      throw new BadRequestException('Provider is not OIDC');
    }

    const flowState = parseOidcFlowState(
      this.readCookie(req, OIDC_FLOW_COOKIE),
      this.getAppSecret(),
    );

    if (!flowState || flowState.providerId !== providerId) {
      throw new BadRequestException('Invalid or expired OIDC flow state');
    }

    res.clearCookie(OIDC_FLOW_COOKIE, { path: '/auth/sso' });

    const config = this.providerService.getDecryptedOidcConfig(provider);

    const identity = await this.oidcService.handleCallback(
      config,
      this.buildCallbackUrl(providerId),
      query,
      { state: flowState.state, nonce: flowState.nonce },
    );

    const redirectUrl = await this.ssoAuthService.completeSignIn(
      identity,
      provider.workspaceId,
    );

    res.redirect(redirectUrl);
  }

  private buildAcsUrl(providerId: string): string {
    return `${this.getServerUrl()}/auth/sso/${providerId}/acs`;
  }

  private buildCallbackUrl(providerId: string): string {
    return `${this.getServerUrl()}/auth/sso/${providerId}/callback`;
  }

  private getServerUrl(): string {
    return this.twentyConfigService.get('SERVER_URL').replace(/\/$/, '');
  }

  private getAppSecret(): string {
    return this.twentyConfigService.get('APP_SECRET');
  }

  /** Lecture brute du cookie (pas de cookie-parser global configuré). */
  private readCookie(req: Request, name: string): string {
    const header = req.headers.cookie;

    if (!header) {
      return '';
    }

    for (const part of header.split(';')) {
      const [key, ...rest] = part.trim().split('=');

      if (key === name) {
        return decodeURIComponent(rest.join('='));
      }
    }

    return '';
  }
}
