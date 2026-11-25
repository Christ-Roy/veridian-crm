import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isNonEmptyString } from '@sniptt/guards';
import { IsNull, Repository } from 'typeorm';

import { ApplicationLifecycleJobService } from 'src/engine/core-modules/application/application-install/services/application-lifecycle-job.service';
import { MarketplaceQueryService } from 'src/engine/core-modules/application/application-marketplace/marketplace-query.service';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import {
  KeyValuePairEntity,
  KeyValuePairType,
} from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { JobStateEnum } from 'src/engine/core-modules/message-queue/enums/job-state.enum';
import { isApplicationInstallAllowedByVeridian } from 'src/engine/core-modules/veridian-coupures/is-application-install-allowed-by-veridian.util';

const POLL_MS = 1_000;
const POLLS = 40;

type Target = { applicationUniversalIdentifier: string; workspaceId: string };

export type DelegatedAppCheck =
  | { kind: 'ok'; applicationId: string }
  | { kind: 'refused'; status: 403 | 503; error: string; message: string };

const refused = (
  status: 403 | 503,
  error: string,
  message: string,
): DelegatedAppCheck => ({ kind: 'refused', status, error, message });

// Veridian (Robert, 24/11/2026: no key, no login, nothing to install by hand): the first valid action installs the app that
// brings its tool. The owner switched the link on at the Hub; the install guards (VER-173, instance catalog) stay whole:
// an app nobody opened to this workspace is refused by name. An app a human removed never comes back by itself.
@Injectable()
export class VeridianDelegatedAppService {
  private readonly logger = new Logger(VeridianDelegatedAppService.name);

  constructor(
    private readonly applicationService: ApplicationService,
    private readonly marketplaceQueryService: MarketplaceQueryService,
    private readonly applicationLifecycleJobService: ApplicationLifecycleJobService,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(KeyValuePairEntity)
    private readonly keyValuePairRepository: Repository<KeyValuePairEntity>,
  ) {}

  async ensureInstalled(target: Target): Promise<DelegatedAppCheck> {
    const { applicationUniversalIdentifier, workspaceId } = target;

    const application = await this.findApplication(target);

    if (application && isNonEmptyString(application.version)) {
      await this.markSeen(target);

      return { kind: 'ok', applicationId: application.id };
    }

    const isInstalling = application !== null;

    if (!isInstalling && (await this.wasSeen(target))) {
      return refused(
        403,
        'app_uninstalled',
        'The app behind this action was uninstalled from this workspace: an admin can install it again in Settings > Applications.',
      );
    }

    try {
      const applicationRegistration =
        await this.marketplaceQueryService.findRegistrationByUniversalIdentifier(
          applicationUniversalIdentifier,
        );

      if (
        !isApplicationInstallAllowedByVeridian({
          workspaceId,
          applicationUniversalIdentifier,
          applicationRegistration,
        })
      ) {
        return refused(
          403,
          'app_not_available',
          'The app behind this action is not open to this workspace yet.',
        );
      }

      const { jobId } =
        await this.applicationLifecycleJobService.triggerInstallApplication({
          universalIdentifier: applicationUniversalIdentifier,
          workspaceId,
        });

      return await this.waitForJob(target, jobId);
    } catch (error) {
      return this.installFailed(
        error instanceof Error ? error.message : 'unknown',
        target,
      );
    }
  }

  private async waitForJob(
    target: Target,
    jobId: string,
  ): Promise<DelegatedAppCheck> {
    for (let poll = 0; poll < POLLS; poll++) {
      const status =
        await this.applicationLifecycleJobService.findInstallApplicationJobStatus(
          {
            universalIdentifier: target.applicationUniversalIdentifier,
            workspaceId: target.workspaceId,
            jobId,
          },
        );

      // A finished job may already be gone from the queue, or fail because another call installed the app first.
      const isOver =
        !status ||
        status.state === JobStateEnum.COMPLETED ||
        status.state === JobStateEnum.FAILED;
      const installed = isOver ? await this.findApplication(target) : null;

      if (installed && isNonEmptyString(installed.version)) {
        await this.markSeen(target);
        this.logger.log(
          `App ${target.applicationUniversalIdentifier} installed on first action in ${target.workspaceId}`,
        );

        return { kind: 'ok', applicationId: installed.id };
      }

      if (status?.state === JobStateEnum.FAILED) {
        return this.installFailed(status.failedReason ?? 'unknown', target);
      }

      await this.wait();
    }

    return refused(
      503,
      'app_installing',
      'The app behind this action is being installed, retry in a minute.',
    );
  }

  private installFailed(reason: string, target: Target): DelegatedAppCheck {
    this.logger.error(
      `App ${target.applicationUniversalIdentifier} not installed in ${target.workspaceId}: ${reason}`,
    );

    return refused(
      503,
      'app_install_failed',
      'The app behind this action could not be installed, retry later.',
    );
  }

  // While it installs, the row exists without a version.
  private findApplication({
    applicationUniversalIdentifier,
    workspaceId,
  }: Target) {
    return this.applicationService.findOneApplication({
      universalIdentifier: applicationUniversalIdentifier,
      workspaceId,
    });
  }

  private markKey({ applicationUniversalIdentifier }: Target) {
    return `veridian.delegated_app:${applicationUniversalIdentifier}`;
  }

  private async wasSeen(target: Target): Promise<boolean> {
    return this.keyValuePairRepository.exists({
      where: {
        key: this.markKey(target),
        workspaceId: target.workspaceId,
        userId: IsNull(),
      },
    });
  }

  private async markSeen(target: Target): Promise<void> {
    if (await this.wasSeen(target)) {
      return;
    }

    // Two first calls at once: the unique index keeps one, the other has nothing to do.
    await this.keyValuePairRepository
      .createQueryBuilder()
      .insert()
      .values({
        key: this.markKey(target),
        value: { seen: true } as never,
        type: KeyValuePairType.USER_VARIABLE,
        workspaceId: target.workspaceId,
        userId: null,
      })
      .orIgnore()
      .execute();
  }

  protected wait(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
