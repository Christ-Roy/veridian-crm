import { Controller, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { type Request, type Response } from 'express';
import { ApiPath } from 'twenty-shared/types';
import { type Repository } from 'typeorm';

import { APPLICATION_CONNECTION_ACCESS_POLICY } from 'src/engine/core-modules/application/connection-provider/connections/constants/application-connection-access-policy.constant';
import { KeyValuePairEntity } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import {
  isCatalogApplicationAllowedByVeridian,
  isLogicFunctionAllowedByVeridian,
} from 'src/engine/core-modules/veridian-coupures/is-logic-function-allowed-by-veridian.util';
import {
  DELEGATING_APP,
  findDelegatedAction,
  isDelegatedTarget,
} from 'src/engine/core-modules/veridian-delegation/constants/delegated-targets.constant';
import { VeridianDelegationService } from 'src/engine/core-modules/veridian-delegation/services/veridian-delegation.service';
import { AccessPolicyGuard } from 'src/engine/guards/access-policy.guard';
import { JwtAuthGuard } from 'src/engine/guards/jwt-auth.guard';

const PAYLOAD_MAX_BYTES = 256_000;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9-]{8,128}$/;

// The screens of the Liaisons app act here, for the person who clicked: never an API key, an agent or another app.
@Controller(`${ApiPath.Apps}/veridian/actions`)
@UseGuards(
  JwtAuthGuard,
  AccessPolicyGuard(APPLICATION_CONNECTION_ACCESS_POLICY),
)
export class VeridianDelegationController {
  constructor(
    private readonly veridianDelegationService: VeridianDelegationService,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(KeyValuePairEntity)
    private readonly keyValuePairRepository: Repository<KeyValuePairEntity>,
  ) {}

  @Post('state')
  async state(@Req() request: Request, @Res() response: Response) {
    const actor = await this.findActor(request);

    return actor
      ? response
          .status(200)
          .json(await this.veridianDelegationService.describe(actor))
      : response.status(403).json({ error: 'not_a_person' });
  }

  @Post(':target/:action')
  async act(
    @Req() request: Request,
    @Res() response: Response,
    @Param('target') target: string,
    @Param('action') action: string,
  ) {
    const actor = await this.findActor(request);

    if (!actor) {
      return response.status(403).json({ error: 'not_a_person' });
    }

    const delegated = isDelegatedTarget(target)
      ? findDelegatedAction(target, action)
      : null;

    if (!isDelegatedTarget(target) || !delegated) {
      return response.status(404).json({ error: 'unknown_action' });
    }

    const { payload, idempotency_key: idempotencyKey } = request.body ?? {};

    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload) ||
      JSON.stringify(payload).length > PAYLOAD_MAX_BYTES ||
      (idempotencyKey !== undefined && !IDEMPOTENCY_KEY.test(idempotencyKey)) ||
      (delegated.isIdempotent &&
        payload.dry_run !== true &&
        idempotencyKey === undefined)
    ) {
      return response.status(400).json({ error: 'invalid_body' });
    }

    const { status, body } = await this.veridianDelegationService.act({
      ...actor,
      target,
      action,
      scope: delegated.scope,
      payload,
      idempotencyKey,
    });

    return response.status(status).json(body);
  }

  // The identifier is written in a manifest anyone can deploy: the app must also be one of ours in this workspace.
  private async findActor(
    request: Request,
  ): Promise<{ userId: string; workspaceId: string } | null> {
    const {
      application,
      workspace,
      user,
      userWorkspaceId,
      agentId,
      impersonationContext,
    } = request;

    if (
      !application ||
      !workspace ||
      !user ||
      !userWorkspaceId ||
      agentId !== undefined ||
      impersonationContext !== undefined ||
      application.universalIdentifier !== DELEGATING_APP
    ) {
      return null;
    }

    const isOurs =
      isLogicFunctionAllowedByVeridian({
        workspaceId: workspace.id,
        applicationUniversalIdentifier: application.universalIdentifier,
      }) ||
      (await isCatalogApplicationAllowedByVeridian(
        this.keyValuePairRepository.manager,
        application,
      ));

    return isOurs ? { userId: user.id, workspaceId: workspace.id } : null;
  }
}
