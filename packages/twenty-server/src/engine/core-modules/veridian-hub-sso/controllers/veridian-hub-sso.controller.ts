import {
  type RawBodyRequest,
  Controller,
  Get,
  Param,
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SUPPORTED_PLANS = [
  'free',
  'freemium',
  'starter',
  'pro',
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

    const { email, hub_user_id: hubUserId } = request.body ?? {};

    if (!isNonEmptyString(email) || !UUID_PATTERN.test(hubUserId ?? '')) {
      return this.rejectInvalidBody(response);
    }

    try {
      const magicLinkUrl = await this.veridianHubSsoService.issueMagicLinkUrl(
        hubUserId,
        email,
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
  async followMagicLink(@Query('t') token: string, @Res() response: Response) {
    const redirectUrl = isNonEmptyString(token)
      ? await this.veridianHubSsoService.resolveRedirectUrl(token)
      : null;

    return response.redirect(
      redirectUrl ?? this.twentyConfigService.get('SERVER_URL'),
    );
  }

  // Nobody signs in here: the login page sends to the Hub, which bounces back.
  @Get('welcome')
  async redirectToHub(@Res() response: Response) {
    const hubLoginUrl = process.env.HUB_LOGIN_URL;
    const next = this.twentyConfigService.get('SERVER_URL');

    return hubLoginUrl
      ? response.redirect(`${hubLoginUrl}?next=${encodeURIComponent(next)}`)
      : response.status(503).json({ error: 'hub_sso_not_configured' });
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

  @Post('api/hub/users/sync')
  async syncUser(
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!this.isAuthenticHubCall(request, response)) {
      return;
    }

    const { hub_user_id: hubUserId, email, name, deleted } = request.body ?? {};

    if (!UUID_PATTERN.test(hubUserId ?? '')) {
      return this.rejectInvalidBody(response);
    }

    const synced = await this.veridianHubSsoService.syncUser({
      hubUserId,
      email,
      name,
      deleted,
    });

    return synced
      ? response.status(200).json({ synced: true })
      : response.status(404).json({ error: 'user_not_in_app' });
  }

  // No body on these two: the signature covers `${ts}.` (§3.8) or the path (§5.12).
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
    const signedPayload = Buffer.from(
      `GET.${request.path}?email=${encodeURIComponent(email ?? '')}`,
    );

    if (!this.isAuthenticHubCall(request, response, signedPayload)) {
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
