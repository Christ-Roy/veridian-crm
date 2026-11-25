import { setTimeout } from 'node:timers/promises';

import { Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';

import { type CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { type MessageQueueJobData } from 'src/engine/core-modules/message-queue/interfaces/message-queue-job.interface';
import { type MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { isWorkspaceSuspended } from 'src/engine/core-modules/workspace/utils/is-workspace-suspended.util';

export const SUSPENDED_JOB_DELAY_MS = 5 * 60 * 1000;

// A worker takes jobs before every cache provider is registered: the first read may fail for a moment.
const READ_ATTEMPTS = 5;
const READ_RETRY_MS = 1000;

// What suspending itself asks for: the push subscriptions at Google and Microsoft are revoked, then created again.
const JOBS_RUN_WHILE_SUSPENDED = ['SyncWorkspaceWebhookSubscriptionsJob'];

const logger = new Logger('SuspendedWorkspaceJobs');

type PostponableJob = {
  name: string;
  data?: unknown;
  retryLimit?: number;
};

const findWorkspaceId = (data: unknown): string | null => {
  const first = Array.isArray(data) ? data[0] : data;
  const workspaceId = (first as { workspaceId?: unknown } | undefined)
    ?.workspaceId;

  return isNonEmptyString(workspaceId) ? workspaceId : null;
};

// Still unreadable: the job runs. A broken cache must not lose the work of every active workspace.
const readIsSuspended = async (
  workspaceId: string,
  coreEntityCacheService: Pick<CoreEntityCacheService, 'get'>,
): Promise<boolean> => {
  for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt++) {
    try {
      return isWorkspaceSuspended(
        await coreEntityCacheService.get('workspaceEntity', workspaceId),
      );
    } catch (error) {
      logger.warn(`Workspace ${workspaceId} unreadable (${attempt}): ${error}`);
      await setTimeout(READ_RETRY_MS);
    }
  }

  return false;
};

// CONTRAT-HUB §5.4: no background work for a suspended workspace, and none lost. The job goes back to its queue until
// the workspace is active again, which one gate covers for every queue instead of one check per job.
export const postponeSuspendedWorkspaceJob = async (
  job: PostponableJob,
  queue: Pick<MessageQueueService, 'add'>,
  coreEntityCacheService: Pick<CoreEntityCacheService, 'get'>,
): Promise<boolean> => {
  const workspaceId = findWorkspaceId(job.data);

  if (!workspaceId || JOBS_RUN_WHILE_SUSPENDED.includes(job.name)) {
    return false;
  }

  if (!(await readIsSuspended(workspaceId, coreEntityCacheService))) {
    return false;
  }

  await queue.add(job.name, job.data as MessageQueueJobData, {
    delay: SUSPENDED_JOB_DELAY_MS,
    retryLimit: job.retryLimit,
    workspaceId,
    isWorkspaceJob: true,
  });

  return true;
};
