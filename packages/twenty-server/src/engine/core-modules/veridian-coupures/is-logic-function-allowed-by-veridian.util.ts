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

// Les étapes Code des workflows appartiennent à l'app de l'espace, jamais listée : liste active = étapes refusées.
export const isVeridianLogicFunctionAllowListActive = (): boolean =>
  process.env.VERIDIAN_LOGIC_FUNCTION_ALLOW !== undefined;
