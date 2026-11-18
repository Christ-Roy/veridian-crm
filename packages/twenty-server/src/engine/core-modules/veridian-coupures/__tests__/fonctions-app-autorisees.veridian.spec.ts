import { isLogicFunctionAllowedByVeridian } from 'src/engine/core-modules/veridian-coupures/is-logic-function-allowed-by-veridian.util';
import { isWorkflowActionDisabledByVeridian } from 'src/engine/core-modules/veridian-coupures/is-workflow-action-disabled-by-veridian.util';

// Patch-survival Veridian (ROB-235) : seules les fonctions d'app des couples (espace, app) listés s'exécutent.
describe("fonctions d'app autorisées par couple (espace, app)", () => {
  const env = { ...process.env };
  const veridian4 = '38627be0-428f-4924-aa67-4a35884ba7b4';
  const meet = '65f44458-3dde-49de-9b19-c52b60b5d1e8';
  const autreEspace = 'c6005824-6d1a-4c72-b5e6-b94ee950477a';
  const autreApp = 'b6f0d2e4-8a51-4c3e-9f27-1d6a4b8c0e52';

  afterEach(() => {
    process.env = { ...env };
  });

  it('exécute le couple listé', () => {
    process.env.VERIDIAN_LOGIC_FUNCTION_ALLOW = `${veridian4}:${meet}`;
    expect(isLogicFunctionAllowedByVeridian({ workspaceId: veridian4, applicationUniversalIdentifier: meet })).toBe(true);
  });

  it("refuse l'identifiant de Meet copié dans un autre espace", () => {
    process.env.VERIDIAN_LOGIC_FUNCTION_ALLOW = `${veridian4}:${meet}`;
    expect(isLogicFunctionAllowedByVeridian({ workspaceId: autreEspace, applicationUniversalIdentifier: meet })).toBe(false);
  });

  it('refuse une autre app du même espace', () => {
    process.env.VERIDIAN_LOGIC_FUNCTION_ALLOW = `${veridian4}:${meet}`;
    expect(isLogicFunctionAllowedByVeridian({ workspaceId: veridian4, applicationUniversalIdentifier: autreApp })).toBe(false);
  });

  it('refuse tout quand la variable est absente, vide ou malformée (fermé par défaut)', () => {
    delete process.env.VERIDIAN_LOGIC_FUNCTION_ALLOW;
    expect(isLogicFunctionAllowedByVeridian({ workspaceId: veridian4, applicationUniversalIdentifier: meet })).toBe(false);
    process.env.VERIDIAN_LOGIC_FUNCTION_ALLOW = '';
    expect(isLogicFunctionAllowedByVeridian({ workspaceId: veridian4, applicationUniversalIdentifier: meet })).toBe(false);
    process.env.VERIDIAN_LOGIC_FUNCTION_ALLOW = `${meet}`;
    expect(isLogicFunctionAllowedByVeridian({ workspaceId: veridian4, applicationUniversalIdentifier: meet })).toBe(false);
  });

  it('accepte plusieurs couples, espaces et casse indifférents', () => {
    process.env.VERIDIAN_LOGIC_FUNCTION_ALLOW = ` ${autreEspace}:${autreApp} , ${veridian4.toUpperCase()}:${meet} `;
    expect(isLogicFunctionAllowedByVeridian({ workspaceId: veridian4, applicationUniversalIdentifier: meet })).toBe(true);
    expect(isLogicFunctionAllowedByVeridian({ workspaceId: autreEspace, applicationUniversalIdentifier: autreApp })).toBe(true);
  });

  it('refuse les étapes Code des workflows dès que la liste est active, même en LOCAL', () => {
    process.env.LOGIC_FUNCTION_TYPE = 'LOCAL';
    process.env.VERIDIAN_LOGIC_FUNCTION_ALLOW = `${veridian4}:${meet}`;
    expect(isWorkflowActionDisabledByVeridian('CODE')).toBe(true);
    expect(isWorkflowActionDisabledByVeridian('LOGIC_FUNCTION')).toBe(true);
  });
});
