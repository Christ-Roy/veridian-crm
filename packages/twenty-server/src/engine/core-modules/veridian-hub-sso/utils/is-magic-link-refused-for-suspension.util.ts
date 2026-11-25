import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

export type MembershipActivation = {
  subdomain: string;
  activationStatus: string;
};

// CONTRAT-HUB §5.21 : refus (423) seulement si l'espace demandé est suspendu, ou si tous les espaces
// accessibles du membre le sont. Un membre qui a un espace actif entre toujours, dans celui-là.
export const isMagicLinkRefusedForSuspension = (
  memberships: MembershipActivation[],
  requestedSubdomain: string | null,
): boolean => {
  const requestedSuspended = memberships.some(
    (m) =>
      requestedSubdomain !== null &&
      m.subdomain === requestedSubdomain &&
      m.activationStatus === WorkspaceActivationStatus.SUSPENDED,
  );
  const allSuspended =
    memberships.length > 0 &&
    memberships.every(
      (m) => m.activationStatus === WorkspaceActivationStatus.SUSPENDED,
    );

  return requestedSuspended || allSuspended;
};
