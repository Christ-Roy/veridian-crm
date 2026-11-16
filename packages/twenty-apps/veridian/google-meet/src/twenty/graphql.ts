import { CoreApiClient } from 'twenty-client-sdk/core';
import { MetadataApiClient } from 'twenty-client-sdk/metadata';

// Requête GraphQL brute, avec le jeton du front component et son rafraîchissement automatique (le mécanisme
// interne des clients du SDK, déjà employé par l'app Dossiers). Les requêtes sont écrites en clair : le typage
// porte sur ce que l'app lit, vérifié à la réception.

type ReponseGraphql = { data?: unknown; errors?: Array<{ message?: string }> };
type ClientBrut = {
  executeGraphqlRequestWithOptionalRefresh: (args: {
    operation: { query: string; variables: Record<string, unknown> };
  }) => Promise<ReponseGraphql>;
};

export class ErreurTwenty extends Error {}

export const graphql = async <T>(
  cible: 'core' | 'metadata',
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> => {
  const client = (cible === 'core' ? new CoreApiClient() : new MetadataApiClient()) as unknown as ClientBrut;
  const reponse = await client.executeGraphqlRequestWithOptionalRefresh({ operation: { query, variables } });
  if (reponse.errors && reponse.errors.length > 0)
    throw new ErreurTwenty(reponse.errors.map((e) => e.message ?? 'erreur').join(' ; '));
  if (reponse.data === undefined || reponse.data === null) throw new ErreurTwenty('réponse GraphQL vide');
  return reponse.data as T;
};

export const messageErreur = (e: unknown): string => (e instanceof Error ? e.message : String(e));
