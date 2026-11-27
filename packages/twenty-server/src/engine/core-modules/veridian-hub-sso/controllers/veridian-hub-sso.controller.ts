import {
  type RawBodyRequest,
  Controller,
  Delete,
  Get,
  Logger,
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
import { VeridianGrantService } from 'src/engine/core-modules/veridian-delegation/services/veridian-grant.service';
import { parseHubGrants } from 'src/engine/core-modules/veridian-delegation/utils/parse-hub-grants.util';
import { VeridianHubOrganisationService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-organisation.service';
import { VeridianHubRoleService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-role.service';
import { VeridianHubPlatformAdminService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-platform-admin.service';
import {
  VeridianHubSsoService,
  WORKSPACE_SUSPENDED_LINK,
} from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service';
import {
  isSuspensionReason,
  VeridianHubSuspensionService,
} from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-suspension.service';
import {
  buildSignInPage,
  SIGN_IN_PAGE_CONTENT_SECURITY_POLICY,
} from 'src/engine/core-modules/veridian-hub-sso/utils/build-sign-in-page.util';
import {
  isHubRole,
  isHubRoleVersion,
  isUuid,
  parseHubOrganisations,
} from 'src/engine/core-modules/veridian-hub-sso/utils/parse-hub-organisations.util';
import { parseHubOrganisation } from 'src/engine/core-modules/veridian-hub-sso/utils/parse-hub-organisation.util';
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

const SUSPENSION_ERRORS = {
  not_found: [404, 'tenant_not_found'],
  workspace_gone: [410, 'workspace_gone'],
  not_active: [409, 'workspace_not_active'],
  not_suspended_by_hub: [409, 'not_suspended_by_hub'],
} as const;

const ORGANISATION_ERRORS = {
  tenant_not_linked: 404,
  workspace_suspended: 423,
  logo_unreachable: 502,
  members_failed: 502,
};

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
    private readonly veridianHubRoleService: VeridianHubRoleService,
    private readonly veridianHubOrganisationService: VeridianHubOrganisationService,
    private readonly veridianHubSuspensionService: VeridianHubSuspensionService,
    private readonly veridianGrantService: VeridianGrantService,
    private readonly veridianHubPlatformAdminService: VeridianHubPlatformAdminService,
  ) {}

  private readonly signatureLogger = new Logger('VeridianHubSignature');

  // Returns false once it has answered: the caller stops there.
  private async isAuthenticHubCall(
    request: RawBodyRequest<Request>,
    response: Response,
    signedPayload: Buffer | undefined = request.rawBody,
  ): Promise<boolean> {
    const secrets = [
      process.env.HUB_API_SECRET,
      process.env.HUB_API_SECRET_NEXT,
    ].filter(isNonEmptyString);

    if (secrets.length === 0) {
      response.status(503).json({ error: 'hub_sso_not_configured' });

      return false;
    }

    const signature = readHeader(request, 'x-veridian-hub-signature');
    const version =
      readHeader(request, 'x-veridian-sig-version')?.trim() === '2' ? 'v2' : 'v1';

    // Veridian (26/11/2026): once the Hub signs v2 for the CRM (HMAC_V2_APPS), v1 is refused, as in Notifuse.
    if (version === 'v1' && process.env.VERIDIAN_HMAC_REQUIRE_V2 === 'true') {
      response.status(401).json({ error: 'signature_v2_required' });

      return false;
    }

    const isSigned = isHubSignatureValid({
      rawBody: signedPayload,
      timestamp: readHeader(request, 'x-veridian-timestamp'),
      signature,
      secrets,
      version,
      route: { method: request.method, originalUrl: request.originalUrl },
    });

    if (!isSigned || !isNonEmptyString(signature)) {
      response.status(401).json({ error: 'invalid_signature' });

      return false;
    }

    // Veridian (26/11/2026): counted before VERIDIAN_HMAC_REQUIRE_V2 is set (a day without any v1 call).
    if (version === 'v1') {
      this.signatureLogger.warn(
        `hub_signature_v1 ${JSON.stringify({ method: request.method, route: (request.originalUrl ?? '').split('?')[0].replace(/[0-9a-f-]{36}/gi, ':id') })}`,
      );
    }

    if (!(await this.veridianHubSsoService.consumeHubSignature(signature))) {
      response.status(401).json({ error: 'signature_already_used' });

      return false;
    }

    return true;
  }

  private rejectInvalidBody(response: Response) {
    return response.status(400).json({ error: 'invalid_body' });
  }

  // CONTRAT-HUB §5.19.7: a person is named by hub_user_id, the email is information.
  private rejectInvalidPayload(response: Response) {
    return response.status(400).json({ error: 'invalid_payload' });
  }

  @Post('api/sso/issue-magic-link')
  async issueMagicLink(
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!(await this.isAuthenticHubCall(request, response))) {
      return;
    }

    const { email, hub_user_id: hubUserId, next } = request.body ?? {};

    if (!isNonEmptyString(email) || !UUID_PATTERN.test(hubUserId ?? '')) {
      return this.rejectInvalidBody(response);
    }

    await this.veridianHubRoleService.applyRolesAtSignIn(
      hubUserId,
      parseHubOrganisations(request.body?.organisations),
    );

    try {
      const magicLinkUrl = await this.veridianHubSsoService.issueMagicLinkUrl(
        hubUserId,
        email,
        next,
        request.body?.email_proven === true,
      );

      if (magicLinkUrl === WORKSPACE_SUSPENDED_LINK) {
        return response.status(423).json({ error: 'workspace_suspended' });
      }

      if (!magicLinkUrl) {
        return response.status(400).json({
          error: 'user_not_in_app',
          hint: 'no workspace for this hub_user_id',
        });
      }

      await this.veridianGrantService.storeAtSignIn(
        hubUserId,
        parseHubGrants(request.body?.delegations),
      );

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
        .setHeader('Content-Security-Policy', SIGN_IN_PAGE_CONTENT_SECURITY_POLICY)
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
    if (!(await this.isAuthenticHubCall(request, response))) {
      return;
    }

    const {
      tenant_id: tenantId,
      owner_email: ownerEmail,
      workspace_name: workspaceName,
      plan,
      metadata,
    } = request.body ?? {};
    const hubUserId =
      request.body?.owner_hub_user_id ?? metadata?.hub_user_id;

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
      emailProven: request.body?.email_proven === true,
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
    if (!(await this.isAuthenticHubCall(request, response))) {
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

  private rejectSuspension(
    response: Response,
    status: keyof typeof SUSPENSION_ERRORS,
  ) {
    const [code, error] = SUSPENSION_ERRORS[status];

    return response.status(code).json({ error });
  }

  // CONTRAT-HUB §5.4. Idempotent in both directions.
  @Post('api/tenants/suspend')
  async suspendTenant(
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!(await this.isAuthenticHubCall(request, response))) {
      return;
    }

    const { tenant_id: tenantId, reason } = request.body ?? {};

    if (!isNonEmptyString(tenantId) || !isSuspensionReason(reason)) {
      return this.rejectInvalidBody(response);
    }

    const outcome = await this.veridianHubSuspensionService.suspend(
      tenantId,
      reason,
    );

    if (outcome.status !== 'ok') {
      return this.rejectSuspension(response, outcome.status);
    }

    return response
      .status(200)
      .json({ tenant_id: tenantId, suspended_at: outcome.at });
  }

  @Post('api/tenants/resume')
  async resumeTenant(
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!(await this.isAuthenticHubCall(request, response))) {
      return;
    }

    const { tenant_id: tenantId } = request.body ?? {};

    if (!isNonEmptyString(tenantId)) {
      return this.rejectInvalidBody(response);
    }

    const outcome = await this.veridianHubSuspensionService.resume(tenantId);

    if (outcome.status !== 'ok') {
      return this.rejectSuspension(response, outcome.status);
    }

    return response
      .status(200)
      .json({ tenant_id: tenantId, resumed_at: outcome.at });
  }

  @Post('api/tenants/:tenantId/sync-member')
  async syncMember(
    @Param('tenantId') tenantId: string,
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!(await this.isAuthenticHubCall(request, response))) {
      return;
    }

    const { hub_user_id: hubUserId, role } = request.body ?? {};
    const email = request.body?.email ?? request.body?.user_email;

    if (!isNonEmptyString(email) || !UUID_PATTERN.test(hubUserId ?? '')) {
      return this.rejectInvalidPayload(response);
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
      emailProven: request.body?.email_proven === true,
    });

    if (result.status !== 'ok') {
      return response
        .status(result.status === 'workspace_suspended' ? 423 : 409)
        .json({ error: result.status });
    }

    return response.status(200).json({
      tenant_id: tenantId,
      hub_user_id: hubUserId,
      user_email: email,
      synced: true,
      app_user_id: result.userId,
      app_role: role ?? 'member',
    });
  }

  @Post('api/hub/members/role')
  async applyMemberRole(
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!(await this.isAuthenticHubCall(request, response))) {
      return;
    }

    const {
      hub_tenant_id: hubTenantId,
      hub_user_id: hubUserId,
      role,
      version,
      carried,
    } = request.body ?? {};

    if (isUuid(hubTenantId) && carried === false) {
      const released = await this.veridianHubRoleService.release(hubTenantId);

      return released.status === 'tenant_not_linked'
        ? response.status(404).json({ error: released.status })
        : response.status(200).json({ applied: false, reason: 'released' });
    }

    if (
      !isUuid(hubTenantId) ||
      !isUuid(hubUserId) ||
      !isHubRole(role) ||
      !isHubRoleVersion(version)
    ) {
      return this.rejectInvalidBody(response);
    }

    const result = await this.veridianHubRoleService.applyRole({
      hubTenantId,
      hubUserId,
      role,
      version,
    });

    if (result.status === 'tenant_not_linked') {
      return response.status(404).json({ error: result.status });
    }

    if (!result.applied && result.reason === 'admin_withdrawn') {
      return response.status(409).json({ error: 'admin_withdrawn' });
    }

    return response
      .status(200)
      .json(
        result.applied
          ? { applied: true, native_role: result.nativeRole }
          : { applied: false, reason: result.reason },
      );
  }

  // CONTRAT-HUB §5.23 (VER-263): platform admins are Admin in a client workspace, never owner; the client may take it back.
  @Post('api/hub/workspace-admins')
  async applyWorkspaceAdmin(
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!(await this.isAuthenticHubCall(request, response))) {
      return;
    }

    const {
      workspace_id: workspaceRef,
      hub_user_id: hubUserId,
      action,
      actor_hub_user_id: actor,
      reason,
      reinstate,
    } = request.body ?? {};

    if (
      !isUuid(workspaceRef) ||
      !isUuid(hubUserId) ||
      (action !== 'grant' && action !== 'revoke') ||
      !isNonEmptyString(actor) ||
      actor.length > 200 ||
      (reason !== undefined && reason !== null && typeof reason !== 'string') ||
      (reinstate !== undefined && typeof reinstate !== 'boolean')
    ) {
      return this.rejectInvalidBody(response);
    }

    const result = await this.veridianHubPlatformAdminService.apply({
      workspaceRef,
      hubUserId,
      action,
      actor,
      reason: typeof reason === 'string' ? reason.slice(0, 500) : null,
      reinstate: reinstate === true,
    });

    return result.status === 200
      ? response.status(200).json({ applied: result.applied, role: result.role })
      : response.status(result.status).json({ error: result.error });
  }

  @Get('api/hub/workspace-admins')
  async readWorkspaceAdmins(
    @Query('workspace_id') workspaceRef: string,
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!(await this.isAuthenticHubCall(request, response, Buffer.alloc(0)))) {
      return;
    }

    if (!isUuid(workspaceRef)) {
      return this.rejectInvalidBody(response);
    }

    const members = await this.veridianHubPlatformAdminService.list(workspaceRef);

    return members === null
      ? response.status(404).json({ error: 'tenant_not_found' })
      : response.status(200).json({ members });
  }

  @Post('api/veridian/workspaces/:workspaceId/attach-member')
  async attachMember(
    @Param('workspaceId') workspaceId: string,
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!(await this.isAuthenticHubCall(request, response))) {
      return;
    }

    const { hub_user_id: hubUserId, role } = request.body ?? {};
    const email = request.body?.email ?? request.body?.hub_user_email;

    if (
      !isNonEmptyString(email) ||
      !UUID_PATTERN.test(hubUserId ?? '') ||
      !UUID_PATTERN.test(workspaceId)
    ) {
      return this.rejectInvalidPayload(response);
    }

    const result = await this.veridianHubSsoService.attachMember({
      workspaceId,
      hubUserId,
      email,
      emailProven: request.body?.email_proven === true,
    });

    if (result.status === 'workspace_not_found') {
      return response.status(404).json({ error: result.status });
    }

    if (result.status === 'workspace_suspended') {
      return response.status(423).json({ error: result.status });
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
    if (!(await this.isAuthenticHubCall(request, response))) {
      return;
    }

    const hubUserId = request.body?.hub_user_id;

    if (!UUID_PATTERN.test(hubUserId ?? '')) {
      return this.rejectInvalidPayload(response);
    }

    const workspaceId =
      await this.veridianHubSsoService.findWorkspaceIdByTenant(tenantId);

    if (!workspaceId) {
      return response.status(404).json({ error: 'tenant_not_found' });
    }

    const removed = await this.veridianHubSsoService.removeMember(
      workspaceId,
      hubUserId,
    );

    return response.status(200).json({
      tenant_id: tenantId,
      hub_user_id: hubUserId,
      removed,
      removed_at: removed ? new Date().toISOString() : null,
      ...(await this.veridianHubSsoService.describeApiKeys(workspaceId)),
    });
  }

  @Delete('api/tenants/:tenantId')
  async deleteTenant(
    @Param('tenantId') tenantId: string,
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!(await this.isAuthenticHubCall(request, response, Buffer.alloc(0)))) {
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
    if (!(await this.isAuthenticHubCall(request, response))) {
      return;
    }

    const {
      hub_user_id: hubUserId,
      email,
      name,
      deleted,
      revoke_sessions: revokeSessions,
    } = request.body ?? {};

    if (
      !UUID_PATTERN.test(hubUserId ?? '') ||
      (email !== undefined && email !== null && !isNonEmptyString(email))
    ) {
      return this.rejectInvalidPayload(response);
    }

    const outcome = await this.veridianHubSsoService.syncUser({
      hubUserId,
      email,
      name,
      deleted,
      revokeSessions,
    });

    if (outcome !== 'synced') {
      return response
        .status(outcome === 'email_conflict' ? 409 : 404)
        .json({ error: outcome });
    }

    return response.status(200).json({ synced: true });
  }

  @Post('api/hub/organisations/sync')
  async syncOrganisation(
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!(await this.isAuthenticHubCall(request, response))) {
      return;
    }

    const organisation = parseHubOrganisation(
      request.body,
      process.env.HUB_URL,
    );

    if ('error' in organisation) {
      return organisation.error === 'invalid_body'
        ? this.rejectInvalidBody(response)
        : response.status(422).json({ error: organisation.error });
    }

    const result =
      await this.veridianHubOrganisationService.apply(organisation);

    if (result.status !== 'ok') {
      return response
        .status(ORGANISATION_ERRORS[result.status])
        .json({ error: result.status });
    }

    return response.status(200).json(
      result.applied
        ? {
            applied: true,
            attached: result.attached,
            refused: result.refused,
          }
        : { applied: false, reason: result.reason },
    );
  }

  @Get('api/hub/organisations/sync')
  async readOrganisation(
    @Query('hub_tenant_id') hubTenantId: string,
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!(await this.isAuthenticHubCall(request, response, Buffer.alloc(0)))) {
      return;
    }

    if (!isUuid(hubTenantId)) {
      return this.rejectInvalidBody(response);
    }

    const version =
      await this.veridianHubOrganisationService.readVersion(hubTenantId);

    return version === null
      ? response.status(404).json({ error: 'tenant_not_linked' })
      : response.status(200).json({ version });
  }

  // No body on these two: the signature covers `${ts}.` (§3.8, §6.1).
  @Get('api/hub/users')
  async listUsers(
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!(await this.isAuthenticHubCall(request, response, Buffer.alloc(0)))) {
      return;
    }

    return response
      .status(200)
      .json({ users: await this.veridianHubSsoService.listUsers() });
  }

  @Get('api/users/by-email')
  async usersByEmail(
    @Query('hub_user_id') hubUserId: string,
    @Query('email') email: string,
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    if (!(await this.isAuthenticHubCall(request, response, Buffer.alloc(0)))) {
      return;
    }

    if (hubUserId ? !isUuid(hubUserId) : !isNonEmptyString(email)) {
      return this.rejectInvalidPayload(response);
    }

    const workspaces = await this.veridianHubSsoService.listWorkspaces({
      hubUserId,
      email,
    });

    return response
      .status(200)
      .json(
        workspaces.length > 0 ? { found: true, workspaces } : { found: false },
      );
  }
}
