// Veridian (26/11/2026, chasse transverse) : sans session, la page d'un espace livrait son identifiant interne et un lien
// signé vers son logo, en plus de son nom. Les sous-domaines se devinent (veridian, veridian-2…). Seul le nom reste : les
// parcours qui lisaient l'identifiant (inscription, mot de passe, Google, Microsoft) sont coupés, le Hub seul connecte.
// Le champ est un UUID (graphql) : l'UUID nul ne désigne aucun espace.
export const VERIDIAN_PUBLIC_WORKSPACE_ID = '00000000-0000-0000-0000-000000000000';

export const maskPublicWorkspaceData = <T extends { id: string; logo?: string }>(
  data: T,
): T => ({ ...data, id: VERIDIAN_PUBLIC_WORKSPACE_ID, logo: '' });
