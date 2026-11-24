import { ApplicationRegistrationSourceType } from 'src/engine/core-modules/application/application-registration/enums/application-registration-source-type.enum';
import { type ApplicationRegistrationEntity } from 'src/engine/core-modules/application/application-registration/application-registration.entity';

// Veridian (22/11/2026, VER-173, ex-ROB-238) : installApplication ne vérifie pas le propriétaire, tout espace qui
// connaît l'identifiant d'une app privée l'installe. Seuls les couples (espace, app) de
// VERIDIAN_APP_INSTALL_ALLOW = "<workspaceId>:<appUniversalIdentifier>,…" installent ou mettent à jour du code publié
// (tarball, npm). Variable absente, vide ou malformée : rien (fermé par défaut). LOCAL et OAUTH_ONLY n'installent rien.
const parseAllowList = (raw: string | undefined): Set<string> =>
  new Set(
    (raw ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => /^[0-9a-f-]{36}:[0-9a-f-]{36}$/.test(entry)),
  );

type CatalogFlags = Pick<
  ApplicationRegistrationEntity,
  'sourceType' | 'isListed' | 'isPreInstalled'
>;

// Veridian (24/11/2026) : une app publiée par tarball que l'administrateur d'INSTANCE a listée ou préinstallée passe en
// tout espace. Aucun propriétaire ne pose ces drapeaux (updateGlobal seul, derrière AdminPanelGuard).
export const isInstanceCatalogApplication = ({
  sourceType,
  isListed,
  isPreInstalled,
}: CatalogFlags): boolean =>
  sourceType === ApplicationRegistrationSourceType.TARBALL &&
  (isListed === true || isPreInstalled === true);

export const isApplicationInstallAllowedByVeridian = ({
  workspaceId,
  applicationUniversalIdentifier,
  applicationRegistration,
}: {
  workspaceId: string;
  applicationUniversalIdentifier: string;
  applicationRegistration?: CatalogFlags;
}): boolean =>
  parseAllowList(process.env.VERIDIAN_APP_INSTALL_ALLOW).has(
    `${workspaceId}:${applicationUniversalIdentifier}`.toLowerCase(),
  ) ||
  (applicationRegistration !== undefined &&
    isInstanceCatalogApplication(applicationRegistration));
