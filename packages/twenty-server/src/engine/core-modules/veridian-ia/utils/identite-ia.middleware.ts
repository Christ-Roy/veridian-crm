import { type LanguageModelMiddleware } from 'ai';

import {
  decoderContexteIa,
  EN_TETE_CONTEXTE_IA,
  EN_TETE_IDENTITE_IA,
  signerIdentiteIa,
} from 'src/engine/core-modules/veridian-ia/utils/identite-ia.util';

// Résolution membre -> hub_user_id, enregistrée au démarrage par IdentiteIaService (base, cache) : le middleware reste
// une fonction pure branchée dans la fabrique de fournisseurs amont, sans toucher son injection de dépendances.
type ResoudreHubUserId = (userWorkspaceId: string) => Promise<string | null>;
let resoudreHubUserId: ResoudreHubUserId | null = null;

export const enregistrerResolutionHubUserId = (resoudre: ResoudreHubUserId | null): void => {
  resoudreHubUserId = resoudre;
};

export const estFournisseurVeridian = (providerName: string): boolean =>
  providerName === (process.env.VERIDIAN_IA_FOURNISSEUR ?? 'veridian');

export const middlewareIdentiteIa = (providerName: string): LanguageModelMiddleware => ({
  transformParams: async ({ params }) => {
    const { [EN_TETE_CONTEXTE_IA]: contexteBrut, ...headers } = params.headers ?? {};

    if (!estFournisseurVeridian(providerName)) {
      return { ...params, headers };
    }

    const secret = process.env.VERIDIAN_IA_IDENTITE_SECRET;
    const contexte = decoderContexteIa(contexteBrut);

    if (!secret || !contexte) {
      return { ...params, headers };
    }

    const hubUserId =
      contexte.userWorkspaceId && resoudreHubUserId
        ? await resoudreHubUserId(contexte.userWorkspaceId)
        : null;

    return {
      ...params,
      headers: {
        ...headers,
        [EN_TETE_IDENTITE_IA]: signerIdentiteIa(secret, {
          workspaceId: contexte.workspaceId,
          hubUserId,
          fil: contexte.fil,
        }),
      },
    };
  },
});
