import { PermissionFlagType } from 'twenty-shared/constants';

// No AI provider is wired at Veridian: the AI flag gates chat, agents, skills and AI workflow steps,
// front and server alike, so refusing it to every role removes them without dead screens.
export const isPermissionFlagDisabledByVeridian = (
  permissionFlag: PermissionFlagType,
): boolean =>
  permissionFlag === PermissionFlagType.AI &&
  process.env.VERIDIAN_AI_DISABLED === 'true';
