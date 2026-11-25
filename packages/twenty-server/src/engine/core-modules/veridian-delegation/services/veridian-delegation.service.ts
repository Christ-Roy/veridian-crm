import { Injectable, Logger } from '@nestjs/common';

import { createHmac, randomBytes } from 'crypto';

import {
  DELEGATED_TARGETS,
  type DelegatedTarget,
  findScopes,
  isDelegatedTarget,
} from 'src/engine/core-modules/veridian-delegation/constants/delegated-targets.constant';
import { VeridianGrantService } from 'src/engine/core-modules/veridian-delegation/services/veridian-grant.service';
import { parseActionUrl } from 'src/engine/core-modules/veridian-delegation/utils/parse-action-url.util';

const HUB_TIMEOUT_MS = 8_000;
const ACTION_TIMEOUT_MS = 60_000;
const ANSWER_MAX_BYTES = 1_000_000;

type Actor = { userId: string; workspaceId: string };

export type DelegationAnswer = {
  status: number;
  body: Record<string, unknown>;
};

const refusal = (status: number, error: string): DelegationAnswer => ({
  status,
  body: { error },
});

// CONTRAT-HUB §5.19.5, the CRM as the calling app: a person clicks, the Hub decides every time (member, organisation,
// switch), one 120 s token for one action. No key, and no token ever reaches the browser.
@Injectable()
export class VeridianDelegationService {
  private readonly logger = new Logger(VeridianDelegationService.name);

  constructor(private readonly veridianGrantService: VeridianGrantService) {}

  async act({
    target,
    action,
    scope,
    payload,
    idempotencyKey,
    ...actor
  }: Actor & {
    target: DelegatedTarget;
    action: string;
    scope: string;
    payload: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<DelegationAnswer> {
    const hubTenantId = await this.veridianGrantService.findHubTenantId(
      actor.workspaceId,
    );

    if (!hubTenantId) {
      return refusal(409, 'tenant_not_linked');
    }

    const grant = await this.readGrant(actor);

    if (!grant) {
      return refusal(409, 'sign_in_again');
    }

    const exchange = await this.askHub('/api/delegation/jeton', {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_grant: grant,
      audience: target,
      scope,
      motif: action,
    });

    if (exchange.status !== 200) {
      return this.refuseAsTheHub(exchange, actor, target);
    }

    const { access_token: token, tenant_id: tenantId, url } = exchange.body;
    const actionUrl = parseActionUrl(url);

    if (typeof token !== 'string' || token.length < 20 || !actionUrl) {
      this.logger.error(`Delegation answer unusable target=${target}`);

      return refusal(502, 'hub_answer_invalid');
    }

    // Never the records of one organisation into another.
    if (
      typeof tenantId !== 'string' ||
      tenantId.toLowerCase() !== hubTenantId
    ) {
      this.logger.error(
        `Delegation to another tenant refused target=${target}`,
      );

      return refusal(403, 'other_tenant');
    }

    return this.call(`${actionUrl}/${action}`, token, payload, idempotencyKey);
  }

  async describe(actor: Actor): Promise<Record<string, string>> {
    const states: Record<string, string> = Object.fromEntries(
      Object.keys(DELEGATED_TARGETS).map((target) => [target, 'unknown']),
    );
    const grant = await this.readGrant(actor);

    if (!grant) {
      return { ...states, session: 'sign_in_again' };
    }

    const { status, body } = await this.askHub('/api/delegation/paires', {
      subject_grant: grant,
    });

    if (status !== 200) {
      if (body.error === 'grant_invalid') {
        await this.veridianGrantService.forget(actor.userId, actor.workspaceId);

        return { ...states, session: 'sign_in_again' };
      }

      return states;
    }

    for (const pair of Array.isArray(body.paires) ? body.paires : []) {
      if (
        !isDelegatedTarget(String(pair?.audience)) ||
        typeof pair?.etat !== 'string'
      ) {
        continue;
      }

      // A target may have several switches (contacts, sequences): one that is off never turns the others off.
      if (states[pair.audience] !== 'allumee') {
        states[pair.audience] = pair.etat;
      }

      for (const scope of Array.isArray(pair.portees) ? pair.portees : []) {
        if (findScopes(pair.audience).includes(scope)) {
          states[scope] = pair.etat;
        }
      }
    }

    return states;
  }

  private readGrant({ userId, workspaceId }: Actor) {
    return this.veridianGrantService.read(userId, workspaceId);
  }

  private async refuseAsTheHub(
    { status, body }: DelegationAnswer,
    { userId, workspaceId }: Actor,
    target: DelegatedTarget,
  ): Promise<DelegationAnswer> {
    const error = typeof body.error === 'string' ? body.error : 'hub_refused';

    this.logger.warn(`Delegation refused target=${target} code=${error}`);

    if (error === 'grant_invalid') {
      await this.veridianGrantService.forget(userId, workspaceId);

      return refusal(409, 'sign_in_again');
    }

    return refusal(
      [403, 429, 503].includes(status) ? status : 502,
      error.slice(0, 60),
    );
  }

  private async askHub(
    path: string,
    content: Record<string, unknown>,
  ): Promise<DelegationAnswer> {
    const hubUrl = process.env.HUB_URL?.replace(/\/+$/, '');
    const secret = process.env.HUB_API_SECRET;

    if (!hubUrl || !secret) {
      return refusal(503, 'not_configured');
    }

    const body = JSON.stringify(content);
    const timestamp = String(Date.now());
    const nonce = randomBytes(16).toString('hex');

    return this.post(
      `${hubUrl}${path}`,
      {
        'X-Veridian-App': 'crm',
        'X-Veridian-Timestamp': timestamp,
        'X-Veridian-Nonce': nonce,
        'X-Veridian-Hub-Signature': createHmac('sha256', secret)
          .update(`${timestamp}.${nonce}.${body}`)
          .digest('hex'),
      },
      body,
      HUB_TIMEOUT_MS,
      'hub_unreachable',
    );
  }

  private call(
    url: string,
    token: string,
    payload: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<DelegationAnswer> {
    return this.post(
      url,
      {
        Authorization: `Bearer ${token}`,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      JSON.stringify(payload),
      ACTION_TIMEOUT_MS,
      'target_unreachable',
    );
  }

  private async post(
    url: string,
    headers: Record<string, string>,
    body: string,
    timeoutMs: number,
    unreachable: string,
  ): Promise<DelegationAnswer> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/json', ...headers },
        body,
      });
      const text = await response.text();

      if (text.length > ANSWER_MAX_BYTES) {
        return refusal(502, 'answer_too_large');
      }

      const answer: unknown = JSON.parse(text);

      return typeof answer === 'object' && answer !== null
        ? {
            status: response.status,
            body: answer as Record<string, unknown>,
          }
        : refusal(502, 'answer_invalid');
    } catch (error) {
      this.logger.warn(
        `${unreachable}: ${error instanceof Error ? error.name : 'unknown'}`,
      );

      return error instanceof SyntaxError
        ? refusal(502, 'answer_invalid')
        : refusal(503, unreachable);
    }
  }
}
