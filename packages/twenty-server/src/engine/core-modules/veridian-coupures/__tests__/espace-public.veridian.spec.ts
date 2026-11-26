import {
  VERIDIAN_PUBLIC_WORKSPACE_ID,
  maskPublicWorkspaceData,
} from 'src/engine/core-modules/veridian-coupures/mask-public-workspace-data.util';

// Veridian (26/11/2026) : sans session, un espace ne livre que son nom ; ni identifiant interne, ni lien signé du logo.
describe('Veridian : données publiques d un espace', () => {
  const reel = {
    id: '38627be0-428f-4924-aa67-4a35884ba7b4',
    logo: 'https://crm.app.veridian.site/files/logo?token=signe',
    displayName: 'Espace de démonstration',
    workspaceUrls: { subdomainUrl: 'https://demo.crm.app.veridian.site/', customUrl: null },
  };

  it("masque l'identifiant et le logo", () => {
    const vu = maskPublicWorkspaceData(reel);

    expect(vu.id).toBe(VERIDIAN_PUBLIC_WORKSPACE_ID);
    expect(vu.logo).toBe('');
    expect(JSON.stringify(vu)).not.toContain(reel.id);
    expect(JSON.stringify(vu)).not.toContain('token=');
  });

  it('garde le nom et les adresses (témoin)', () => {
    const vu = maskPublicWorkspaceData(reel);

    expect(vu.displayName).toBe(reel.displayName);
    expect(vu.workspaceUrls).toEqual(reel.workspaceUrls);
  });
});
