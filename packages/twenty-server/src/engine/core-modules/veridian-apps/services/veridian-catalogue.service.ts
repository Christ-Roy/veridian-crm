import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { Repository } from 'typeorm';

import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { MARKETPLACE_CATALOG_CACHE_ENTITY_ID } from 'src/engine/core-modules/application/application-marketplace/constants/marketplace-apps-cache.constant';
import { ApplicationInstallService } from 'src/engine/core-modules/application/application-install/application-install.service';
import { ApplicationRegistrationEntity } from 'src/engine/core-modules/application/application-registration/application-registration.entity';
import {
  ApplicationException,
  ApplicationExceptionCode,
} from 'src/engine/core-modules/application/application.exception';
import {
  desiredCatalogueState,
  excludedFromVeridianDefaults,
  parseVeridianCatalogue,
  veridianEditorWorkspaceIds,
} from 'src/engine/core-modules/veridian-apps/utils/veridian-catalogue.util';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

// Veridian (26/11/2026, Robert) : au démarrage, le catalogue déclaré (VERIDIAN_CATALOGUE) est posé sur les apps de
// l'éditeur (listée, préinstallée, auteur vérifié) ; une app qui devient préinstallée est posée dans chaque espace
// actif hors VERIDIAN_BASE_APPS_EXCLUDE. Les nouveaux espaces la reçoivent par la préinstallation native.
// Variable absente : rien ne change (comportement amont). Plusieurs instances : seule celle qui bascule le drapeau pose.
@Injectable()
export class VeridianCatalogueService implements OnApplicationBootstrap {
  private readonly logger = new Logger('VeridianCatalogue');

  constructor(
    @InjectRepository(ApplicationRegistrationEntity)
    private readonly applicationRegistrationRepository: Repository<ApplicationRegistrationEntity>,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly applicationInstallService: ApplicationInstallService,
    private readonly coreEntityCacheService: CoreEntityCacheService,
  ) {}

  async onApplicationBootstrap() {
    if (process.env.VERIDIAN_CATALOGUE === undefined) {
      return;
    }

    // Never awaited: installing in every workspace must not hold the server's start (canary health check).
    void this.reconcile().catch((error: unknown) =>
      this.logger.error(
        `veridian_catalogue_non_abouti ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  async reconcile(): Promise<{ changed: string[]; installedOn: number }> {
    const catalogue = parseVeridianCatalogue(process.env.VERIDIAN_CATALOGUE);
    const editors = veridianEditorWorkspaceIds();
    const registrations = await this.applicationRegistrationRepository.find({
      select: [
        'id',
        'universalIdentifier',
        'name',
        'ownerWorkspaceId',
        'sourceType',
        'isListed',
        'isPreInstalled',
        'author',
      ],
    });
    const changed: string[] = [];
    const newlyPreInstalled: ApplicationRegistrationEntity[] = [];

    for (const registration of registrations) {
      const desired = desiredCatalogueState(registration, catalogue, editors);

      if (
        desired === null ||
        (desired.isListed === registration.isListed &&
          desired.isPreInstalled === registration.isPreInstalled &&
          desired.author === registration.author)
      ) {
        continue;
      }

      const result = await this.applicationRegistrationRepository.update(
        {
          id: registration.id,
          isListed: registration.isListed,
          isPreInstalled: registration.isPreInstalled,
        },
        desired,
      );

      if ((result.affected ?? 0) === 0) {
        continue;
      }

      changed.push(registration.name);

      if (desired.isPreInstalled && !registration.isPreInstalled) {
        newlyPreInstalled.push(registration);
      }
    }

    if (changed.length > 0) {
      await this.coreEntityCacheService.invalidate(
        'marketplaceCatalog',
        MARKETPLACE_CATALOG_CACHE_ENTITY_ID,
      );
      this.logger.log(`veridian_catalogue ${JSON.stringify({ changed })}`);
    }

    const installedOn = await this.installEverywhere(newlyPreInstalled);

    return { changed, installedOn };
  }

  private async installEverywhere(
    registrations: ApplicationRegistrationEntity[],
  ): Promise<number> {
    if (registrations.length === 0) {
      return 0;
    }

    const excluded = excludedFromVeridianDefaults();
    const workspaces = (
      await this.workspaceRepository.find({
        select: ['id'],
        where: { activationStatus: WorkspaceActivationStatus.ACTIVE },
      })
    ).filter((workspace) => !excluded.has(workspace.id.toLowerCase()));
    let installed = 0;

    for (const registration of registrations) {
      for (const workspace of workspaces) {
        try {
          await this.applicationInstallService.installApplication({
            appRegistrationId: registration.id,
            workspaceId: workspace.id,
          });
          installed += 1;
        } catch (error) {
          if (
            error instanceof ApplicationException &&
            error.code === ApplicationExceptionCode.APP_ALREADY_INSTALLED
          ) {
            continue;
          }
          this.logger.error(
            `veridian_catalogue_installation ${JSON.stringify({ app: registration.name, workspaceId: workspace.id, erreur: error instanceof Error ? error.message.slice(0, 200) : String(error) })}`,
          );
        }
      }
    }

    this.logger.log(
      `veridian_catalogue_installe ${JSON.stringify({ apps: registrations.map((r) => r.name), espaces: workspaces.length, installations: installed, exclus: excluded.size })}`,
    );

    return installed;
  }
}
