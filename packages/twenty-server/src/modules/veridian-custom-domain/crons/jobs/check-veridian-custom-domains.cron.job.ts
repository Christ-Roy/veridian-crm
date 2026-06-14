/*
 * Veridian CRM — Custom domain (white-label) clean-room module.
 * Copyright (c) 2026-present Veridian. Licensed under AGPLv3.
 *
 * Cron horaire : re-vérifie les workspaces qui ont un custom domain déclaré mais
 * pas encore activé (le client vient de poser son CNAME, propagation en cours).
 * Flippe `isCustomDomainEnabled` dès que le DNS résout + le HTTPS répond.
 * Réécriture clean-room du pattern AGPL `CheckPublicDomainsValidRecordsCronJob`.
 */

import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Not, Repository } from 'typeorm';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { SentryCronMonitor } from 'src/engine/core-modules/cron/sentry-cron-monitor.decorator';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { VeridianCustomDomainService } from 'src/modules/veridian-custom-domain/services/veridian-custom-domain.service';

export const CHECK_VERIDIAN_CUSTOM_DOMAINS_CRON_PATTERN = '0 * * * *';

@Processor(MessageQueue.cronQueue)
export class CheckVeridianCustomDomainsCronJob {
  constructor(
    // Sweep cross-workspace des custom domains non activés → repository non-scopé.
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly veridianCustomDomainService: VeridianCustomDomainService,
  ) {}

  @Process(CheckVeridianCustomDomainsCronJob.name)
  @SentryCronMonitor(
    CheckVeridianCustomDomainsCronJob.name,
    CHECK_VERIDIAN_CUSTOM_DOMAINS_CRON_PATTERN,
  )
  async handle(): Promise<void> {
    const workspaces = await this.workspaceRepository.find({
      where: {
        customDomain: Not(IsNull()),
        isCustomDomainEnabled: false,
      },
    });

    for (const workspace of workspaces) {
      try {
        await this.veridianCustomDomainService.checkCustomDomain(workspace);
      } catch (error) {
        // Un domaine en erreur ne doit pas bloquer les autres : on log et on
        // continue le sweep.
        // eslint-disable-next-line no-console
        console.error(
          `[${CheckVeridianCustomDomainsCronJob.name}] workspace ${workspace.id}: ${(error as Error).message}`,
        );
      }
    }
  }
}
