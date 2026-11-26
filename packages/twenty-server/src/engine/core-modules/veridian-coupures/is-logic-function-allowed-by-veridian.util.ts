import { type EntityManager } from 'typeorm';

import { ApplicationRegistrationEntity } from 'src/engine/core-modules/application/application-registration/application-registration.entity';
import { ApplicationRegistrationSourceType } from 'src/engine/core-modules/application/application-registration/enums/application-registration-source-type.enum';
import { type FlatApplication } from 'src/engine/core-modules/application/types/flat-application.type';
import {
  isInstanceCatalogApplication,
  isVeridianBaseApplication,
} from 'src/engine/core-modules/veridian-coupures/is-application-install-allowed-by-veridian.util';

// Veridian (18/11/2026, ROB-235) : en LOCAL, le code d'une app tourne sur le serveur CRM, réseau interne compris.
// N'importe quel propriétaire d'espace peut déposer une app : on n'exécute que les couples (espace, app) listés dans
// VERIDIAN_LOGIC_FUNCTION_ALLOW = "<workspaceId>:<appUniversalIdentifier>,…". Le couple, pas l'app seule : un
// identifiant d'app s'écrit dans un manifeste. Variable absente ou vide : rien ne s'exécute (fermé par défaut).
const parseAllowList = (raw: string | undefined): Set<string> =>
  new Set(
    (raw ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => /^[0-9a-f-]{36}:[0-9a-f-]{36}$/.test(entry)),
  );

export const isLogicFunctionAllowedByVeridian = ({
  workspaceId,
  applicationUniversalIdentifier,
}: {
  workspaceId: string;
  applicationUniversalIdentifier: string;
}): boolean =>
  parseAllowList(process.env.VERIDIAN_LOGIC_FUNCTION_ALLOW).has(
    `${workspaceId}:${applicationUniversalIdentifier}`.toLowerCase(),
  );

// Veridian (24/11/2026) : une app du catalogue d'instance s'exécute en tout espace. L'enregistrement se lit par la clé que
// porte la ligne installée, jamais par le seul identifiant du manifeste ; une ligne LOCAL porte le code de l'espace.
export const isCatalogApplicationAllowedByVeridian = async (
  entityManager: EntityManager,
  {
    applicationRegistrationId,
    universalIdentifier,
    sourceType,
    workspaceId,
  }: Pick<
    FlatApplication,
    'applicationRegistrationId' | 'universalIdentifier' | 'sourceType'
  > & { workspaceId?: string },
): Promise<boolean> => {
  if (
    !applicationRegistrationId ||
    sourceType !== ApplicationRegistrationSourceType.TARBALL
  ) {
    return false;
  }

  const registration = await entityManager
    .getRepository(ApplicationRegistrationEntity)
    .findOne({
      select: [
        'id',
        'universalIdentifier',
        'sourceType',
        'isListed',
        'isPreInstalled',
        'ownerWorkspaceId',
      ],
      where: { id: applicationRegistrationId },
    });

  return (
    registration !== null &&
    registration.universalIdentifier === universalIdentifier &&
    (isInstanceCatalogApplication(registration) ||
      (workspaceId !== undefined &&
        isVeridianBaseApplication({
          workspaceId,
          applicationRegistration: registration,
        })))
  );
};

// Les étapes Code des workflows appartiennent à l'app de l'espace, jamais listée : liste active = étapes refusées.
export const isVeridianLogicFunctionAllowListActive = (): boolean =>
  process.env.VERIDIAN_LOGIC_FUNCTION_ALLOW !== undefined;
