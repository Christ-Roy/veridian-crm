import {
  type RawBodyRequest,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { type CookieOptions, type Request, type Response } from 'express';

import { ThrottlerException } from 'src/engine/core-modules/throttler/throttler.exception';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { VeridianHubSsoService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service';
import { buildSignInPage } from 'src/engine/core-modules/veridian-hub-sso/utils/build-sign-in-page.util';
import { parseOwnUrl } from 'src/engine/core-modules/veridian-hub-sso/utils/parse-own-url.util';
import { isHubSignatureValid } from 'src/engine/core-modules/veridian-hub-sso/utils/is-hub-signature-valid.util';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SIGNED_OUT_COOKIE = 'veridian_signed_out';
const AUTO_TRY_COOKIE = 'veridian_hub_try';
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

const SUPPORTED_PLANS = [
  'free',
  'freemium',
  'starter',
  'pro',
  'business',
  'enterprise',
  'lifetime_site_vitrine',
  'lifetime_partner',
  'internal',
];

const readHeader = (request: Request, name: string): string | undefined => {
  const value = request.headers[name];

  return Array.isArray(value) ? value[0] : value;
};

// Hub to Twenty, CONTRAT-HUB §5 and §6bis.8. Authentication is the HMAC, hence the public guards.
@Controller()
@UseGuards(PublicEndpointGuard, NoPermissionGuard)
export class VeridianHubSsoController {
  constructor(
    private readonly veridianHubSsoService: VeridianHubSsoService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  // Returns false once it has answered: the caller stops there.
  private isAuthenticHubCall(
    request: RawBodyRequest<Request>,
    response: Response,
    signedPayload: Buffer | undefined = request.rawBody,
  ): boolean {
    const secrets = [
      process.env.HUB_API_SECRET,
      process.env.HUB_API_SECRET_NEXT,
    ].filter(isNonEmptyString);

    if (secrets.length === 0) {
      response.status(503).json({ error: 'hub_sso_not_configured' });

      return false;
    }

    const isSigned = isHubSignatureValid({
      rawBody: signedPayload,
      timestamp: readHeader(request, 'x-veridian-timestamp'),
      signature: readHeader(request, 'x-veridian-hub-signature'),
      secrets,
    });

    if (!isSigned) {
      response.status(401).json({ error: 'invalid_signature' });
    }

    return isSigned;
  }

  private rejectInvalidBody(response: Response) {
    return response.status(400).json({ error: 'invalid_body' });
  }

  @Post('api/sso/issue-magic-link')
  async issueMagicLink(
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!this.isAuthenticHubCall(request, response)) {
      return;
    }

    const { email, hub_user_id: hubUserId, next } = request.body ?? {};

    if (!isNonEmptyString(email) || !UUID_PATTERN.test(hubUserId ?? '')) {
      return this.rejectInvalidBody(response);
    }

    try {
      const magicLinkUrl = await this.veridianHubSsoService.issueMagicLinkUrl(
        hubUserId,
        email,
        next,
      );

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
  async followMagicLink(
    @Query('t') token: string,
    @Query('next') nextPath: string,
    @Res() response: Response,
  ) {
    const redirectUrl = isNonEmptyString(token)
      ? await this.veridianHubSsoService.resolveRedirectUrl(token, nextPath)
      : null;

    if (redirectUrl) {
      // Successful sign-in: both markers of §6bis.8.0 fall.
      for (const cookie of [SIGNED_OUT_COOKIE, AUTO_TRY_COOKIE]) {
        response.clearCookie(cookie, this.markerCookieOptions());
      }
    }

    return response.redirect(
      redirectUrl ?? this.twentyConfigService.get('SERVER_URL'),
    );
  }

  private markerCookieOptions(): CookieOptions {
    const server = new URL(this.twentyConfigService.get('SERVER_URL'));

    // Scoped to this app and its workspaces, never to .veridian.site.
    return {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: server.protocol === 'https:',
      ...(server.hostname === 'localhost' ? {} : { domain: server.hostname }),
    };
  }

  // Nobody signs in here: CONTRAT-HUB §6bis.8.0, automatic bounce to the Hub, once,
  // on a full navigation only. Otherwise this page, whose button bounces without `auto`.
  @Get('welcome')
  async welcome(
    @Query('logout') logout: string,
    @Query('next') next: string,
    @Query('returnToPath') returnToPath: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const hubUrl = process.env.HUB_URL;

    if (!hubUrl) {
      return response.status(503).json({ error: 'hub_sso_not_configured' });
    }

    const serverUrl = this.twentyConfigService.get('SERVER_URL');
    const fetchDest = readHeader(request, 'sec-fetch-dest');
    const fetchMode = readHeader(request, 'sec-fetch-mode');

    if (fetchMode !== undefined && fetchMode !== 'navigate') {
      return response.status(401).json({ error: 'unauthenticated' });
    }

    const ownOrigin =
      parseOwnUrl(
        `${request.protocol}://${readHeader(request, 'host')}/`,
        serverUrl,
      )?.origin ?? serverUrl;
    // Twenty carries the requested page in returnToPath when it changes domain.
    const requestedPath =
      returnToPath?.startsWith('/') && !returnToPath.startsWith('//')
        ? returnToPath
        : '';
    const target = parseOwnUrl(next, serverUrl)
      ? next
      : `${ownOrigin}${requestedPath}`;
    const bounce = `${hubUrl}/api/auth/bounce/prepare?next=${encodeURIComponent(target)}`;
    const cookies = readHeader(request, 'cookie') ?? '';
    const options = this.markerCookieOptions();

    if (logout === '1') {
      response.cookie(SIGNED_OUT_COOKIE, '1', {
        ...options,
        maxAge: ONE_YEAR_MS,
      });
    }

    const isBlocked =
      logout === '1' ||
      cookies.includes(`${SIGNED_OUT_COOKIE}=`) ||
      cookies.includes(`${AUTO_TRY_COOKIE}=`) ||
      fetchDest === 'iframe';

    if (isBlocked) {
      return response
        .status(200)
        .type('html')
        .send(buildSignInPage(bounce));
    }

    response.cookie(AUTO_TRY_COOKIE, '1', { ...options, maxAge: FIVE_MINUTES_MS });

    return response.redirect(`${bounce}&auto=1`);
  }

  @Post('api/tenants/provision')
  async provision(
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!this.isAuthenticHubCall(request, response)) {
      return;
    }

    const {
      tenant_id: tenantId,
      owner_email: ownerEmail,
      workspace_name: workspaceName,
      plan,
      metadata,
    } = request.body ?? {};
    const hubUserId = metadata?.hub_user_id;

    if (
      !UUID_PATTERN.test(tenantId ?? '') ||
      !UUID_PATTERN.test(hubUserId ?? '') ||
      !isNonEmptyString(ownerEmail) ||
      !isNonEmptyString(workspaceName)
    ) {
      return this.rejectInvalidBody(response);
    }

    if (!SUPPORTED_PLANS.includes(plan)) {
      return response
        .status(400)
        .json({ error: 'invalid_plan', supported: SUPPORTED_PLANS });
    }

    const result = await this.veridianHubSsoService.provisionTenant({
      tenantId,
      ownerEmail,
      workspaceName: workspaceName.slice(0, 32),
      hubUserId,
      plan,
    });

    if (result.status !== 'ok') {
      return response.status(409).json({ error: result.status });
    }

    return response.status(200).json({
      tenant_id: tenantId,
      workspace_id: result.workspaceId,
      owner_user_id: result.ownerUserId,
      owner_email: ownerEmail,
      plan,
      created: result.created,
      magic_link: result.magicLink,
      auto_login_url: result.magicLink,
    });
  }

  // CONTRAT-BILLING v2 §3. Body errors follow CONTRAT-HUB §5.10.
  @Post('api/tenants/update-plan')
  async updatePlan(
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!this.isAuthenticHubCall(request, response)) {
      return;
    }

    const decision = await this.veridianHubSsoService.updateTenantPlan(
      request.body ?? {},
    );

    if (decision.kind === 'reject') {
      return response.status(decision.status).json({
        error: decision.error,
        message: decision.error,
        ...(decision.details ? { details: decision.details } : {}),
      });
    }

    return response.status(200).json(decision.response);
  }

  @Post('api/tenants/:tenantId/sync-member')
  async syncMember(
    @Param('tenantId') tenantId: string,
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!this.isAuthenticHubCall(request, response)) {
      return;
    }

    const { user_email: email, hub_user_id: hubUserId, role } =
      request.body ?? {};

    if (!isNonEmptyString(email) || !UUID_PATTERN.test(hubUserId ?? '')) {
      return this.rejectInvalidBody(response);
    }

    const workspaceId =
      await this.veridianHubSsoService.findWorkspaceIdByTenant(tenantId);

    if (!workspaceId) {
      return response.status(404).json({ error: 'tenant_not_found' });
    }

    const result = await this.veridianHubSsoService.attachMember({
      workspaceId,
      hubUserId,
      email,
    });

    if (result.status !== 'ok') {
      return response.status(409).json({ error: result.status });
    }

    return response.status(200).json({
      tenant_id: tenantId,
      user_email: email,
      synced: true,
      app_user_id: result.userId,
      app_role: role ?? 'member',
    });
  }

  @Post('api/veridian/workspaces/:workspaceId/attach-member')
  async attachMember(
    @Param('workspaceId') workspaceId: string,
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!this.isAuthenticHubCall(request, response)) {
      return;
    }

    const { hub_user_email: email, hub_user_id: hubUserId, role } =
      request.body ?? {};

    if (
      !isNonEmptyString(email) ||
      !UUID_PATTERN.test(hubUserId ?? '') ||
      !UUID_PATTERN.test(workspaceId)
    ) {
      return this.rejectInvalidBody(response);
    }

    const result = await this.veridianHubSsoService.attachMember({
      workspaceId,
      hubUserId,
      email,
    });

    if (result.status === 'workspace_not_found') {
      return response.status(404).json({ error: result.status });
    }

    if (result.status !== 'ok') {
      return response.status(409).json({ error: result.status });
    }

    return response.status(result.alreadyMember ? 200 : 201).json({
      attached: true,
      already_member: result.alreadyMember,
      member_id: result.userId,
      workspace_id: workspaceId,
      role: role ?? 'member',
      login_url: result.loginUrl,
    });
  }

  @Post('api/tenants/:tenantId/remove-member')
  async removeMember(
    @Param('tenantId') tenantId: string,
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!this.isAuthenticHubCall(request, response)) {
      return;
    }

    const { email } = request.body ?? {};

    if (!isNonEmptyString(email)) {
      return this.rejectInvalidBody(response);
    }

    const workspaceId =
      await this.veridianHubSsoService.findWorkspaceIdByTenant(tenantId);

    if (!workspaceId) {
      return response.status(404).json({ error: 'tenant_not_found' });
    }

    const removed = await this.veridianHubSsoService.removeMember(
      workspaceId,
      email,
    );

    return response.status(200).json({ tenant_id: tenantId, removed });
  }

  @Delete('api/tenants/:tenantId')
  async deleteTenant(
    @Param('tenantId') tenantId: string,
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!this.isAuthenticHubCall(request, response, Buffer.alloc(0))) {
      return;
    }

    const deleted = await this.veridianHubSsoService.deleteTenant(tenantId);

    return deleted
      ? response.status(200).json({ tenant_id: tenantId, deleted: true })
      : response.status(404).json({ error: 'tenant_not_found' });
  }

  @Post('api/hub/users/sync')
  async syncUser(
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!this.isAuthenticHubCall(request, response)) {
      return;
    }

    const {
      hub_user_id: hubUserId,
      email,
      name,
      deleted,
      revoke_sessions: revokeSessions,
    } = request.body ?? {};

    if (!UUID_PATTERN.test(hubUserId ?? '')) {
      return this.rejectInvalidBody(response);
    }

    const synced = await this.veridianHubSsoService.syncUser({
      hubUserId,
      email,
      name,
      deleted,
      revokeSessions,
    });

    return synced
      ? response.status(200).json({ synced: true })
      : response.status(404).json({ error: 'user_not_in_app' });
  }

  // No body on these two: the signature covers `${ts}.` (§3.8, §6.1).
  @Get('api/hub/users')
  async listUsers(
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!this.isAuthenticHubCall(request, response, Buffer.alloc(0))) {
      return;
    }

    return response
      .status(200)
      .json({ users: await this.veridianHubSsoService.listUsers() });
  }

  @Get('api/users/by-email')
  async usersByEmail(
    @Query('email') email: string,
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!this.isAuthenticHubCall(request, response, Buffer.alloc(0))) {
      return;
    }

    if (!isNonEmptyString(email)) {
      return this.rejectInvalidBody(response);
    }

    const workspaces =
      await this.veridianHubSsoService.listWorkspacesByEmail(email);

    return response
      .status(200)
      .json(
        workspaces.length > 0 ? { found: true, workspaces } : { found: false },
      );
  }
}
