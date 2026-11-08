import { PermissionFlagType } from 'twenty-shared/constants';

import { type FlatRole } from 'src/engine/metadata-modules/flat-role/types/flat-role.type';
import { isPermissionFlagGrantedToFlatRole } from 'src/engine/metadata-modules/flat-role/utils/is-permission-flag-granted-to-flat-role.util';
import { buildIsPermissionFlagGranted } from 'src/engine/permissions/role/utils/build-is-permission-flag-granted.util';

const admin = { canUpdateAllSettings: true, canAccessAllTools: true };

const deuxChemins = (permissionFlag: PermissionFlagType) => [
  buildIsPermissionFlagGranted({
    role: admin,
    permissionFlagUniversalIdentifiers: [],
  })(permissionFlag),
  isPermissionFlagGrantedToFlatRole({
    flatRole: { ...admin, rolePermissionFlagIds: [] } as unknown as FlatRole,
    permissionFlag,
    flatRolePermissionFlagMaps: {
      byId: {},
      idByUniversalIdentifier: {},
      universalIdentifiersByApplicationId: {},
    } as never,
  }),
];

// Patch-survival Veridian : un sync amont qui retire la coupure de l'IA doit casser ici.
describe('IA coupée par VERIDIAN_AI_DISABLED', () => {
  afterEach(() => {
    delete process.env.VERIDIAN_AI_DISABLED;
  });

  it("refuse le drapeau AI à l'Admin, sur les deux chemins de calcul", () => {
    process.env.VERIDIAN_AI_DISABLED = 'true';
    expect(deuxChemins(PermissionFlagType.AI)).toEqual([false, false]);
  });

  it('laisse les autres drapeaux, MCP et réglages IA compris', () => {
    process.env.VERIDIAN_AI_DISABLED = 'true';
    expect(deuxChemins(PermissionFlagType.AI_SETTINGS)).toEqual([true, true]);
    expect(deuxChemins(PermissionFlagType.API_KEYS_AND_WEBHOOKS)).toEqual([
      true,
      true,
    ]);
  });

  it('sans la variable, le comportement amont reste', () => {
    expect(deuxChemins(PermissionFlagType.AI)).toEqual([true, true]);
  });
});
