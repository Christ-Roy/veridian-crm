import {
  firstFreeHubWorkspaceSubdomain,
  hubWorkspaceSubdomainBase,
  hubWorkspaceSubdomainCandidates,
} from 'src/engine/core-modules/veridian-hub-sso/utils/hub-workspace-subdomain.util';

// Veridian (26/11/2026) : le sous-domaine suit le nom d'espace envoyé par le Hub, jamais le domaine de l'adresse du
// propriétaire (toute adresse @veridian.site donnait « veridian-N ») ; une organisation de test prend « e2e- ».
describe('sous-domaine d’un espace créé par le Hub', () => {
  it('suit le nom de l’espace, pas l’adresse', () => {
    expect(hubWorkspaceSubdomainBase('Boulangerie Dupont', 'robert@veridian.site')).toBe('boulangerie-dupont');
    expect(hubWorkspaceSubdomainBase('Société Générale Énergie', 'x@gmail.com')).toBe('societe-generale-energie');
  });

  it('préfixe « e2e- » toute organisation de test, par son nom ou par l’adresse du propriétaire', () => {
    expect(hubWorkspaceSubdomainBase('e2e-recette 50', 'e2e-sso-1@veridian.site')).toBe('e2e-recette-50');
    expect(hubWorkspaceSubdomainBase('E2E Mail A', 'robert@veridian.site')).toBe('e2e-mail-a');
    expect(hubWorkspaceSubdomainBase('Recette', 'e2e-sso-17950@veridian.site')).toBe('e2e-recette');
    expect(hubWorkspaceSubdomainBase('', 'e2e-sso-17950@veridian.site')).toBe('e2e-espace');
  });

  it('borne à 30 caractères et rend undefined (génération native) si rien ne tient', () => {
    expect(hubWorkspaceSubdomainBase('Un nom vraiment beaucoup trop long pour un sous-domaine', 'a@b.fr')?.length).toBeLessThanOrEqual(30);
    expect(hubWorkspaceSubdomainBase('!!!', 'a@b.fr')).toBeUndefined();
    expect(hubWorkspaceSubdomainBase('api', 'a@b.fr')).toBeUndefined();
  });

  it('numérote sans dépasser 30 caractères', () => {
    const base = 'e2e-un-nom-de-trente-caractere';
    const c = hubWorkspaceSubdomainCandidates(base);

    expect(base).toHaveLength(30);
    expect(c[0]).toBe(base);
    expect(c[1]).toBe('e2e-un-nom-de-trente-caracte-2');
    expect(c.every((s) => s.length <= 30)).toBe(true);
  });

  it('prend le premier libre, espaces supprimés compris, jamais le sous-domaine par défaut', () => {
    const c = hubWorkspaceSubdomainCandidates('e2e-recette');

    expect(firstFreeHubWorkspaceSubdomain(c, new Set(['e2e-recette', 'e2e-recette-2']), 'app')).toBe('e2e-recette-3');
    expect(firstFreeHubWorkspaceSubdomain(['app', 'app-2'], new Set(), 'app')).toBe('app-2');
    expect(firstFreeHubWorkspaceSubdomain(['a'], new Set(['a']), 'app')).toBeUndefined();
  });
});
