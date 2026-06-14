/*
 * Veridian CRM — Custom domain (white-label) clean-room module.
 * Copyright (c) 2026-present Veridian. Licensed under AGPLv3.
 */

import { Command, CommandRunner } from 'nest-commander';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import {
  CHECK_VERIDIAN_CUSTOM_DOMAINS_CRON_PATTERN,
  CheckVeridianCustomDomainsCronJob,
} from 'src/modules/veridian-custom-domain/crons/jobs/check-veridian-custom-domains.cron.job';

@Command({
  name: 'cron:veridian:check-custom-domains',
  description:
    'Starts a cron job to re-check workspaces with a pending custom domain hourly',
})
export class CheckVeridianCustomDomainsCronCommand extends CommandRunner {
  constructor(
    @InjectMessageQueue(MessageQueue.cronQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {
    super();
  }

  async run(): Promise<void> {
    await this.messageQueueService.addCron<undefined>({
      jobName: CheckVeridianCustomDomainsCronJob.name,
      data: undefined,
      options: {
        repeat: { pattern: CHECK_VERIDIAN_CUSTOM_DOMAINS_CRON_PATTERN },
      },
    });
  }
}
