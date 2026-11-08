import { isWorkflowActionDisabledByVeridian } from 'src/engine/core-modules/veridian-coupures/is-workflow-action-disabled-by-veridian.util';

// Patch-survival Veridian : une étape qui ne peut pas s'exécuter est refusée à sa création.
describe('étapes de workflow refusées', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it("refuse le code client en prod, où Twenty ne l'exécute pas", () => {
    delete process.env.LOGIC_FUNCTION_TYPE;
    process.env.NODE_ENV = 'production';
    expect(isWorkflowActionDisabledByVeridian('CODE')).toBe(true);
    expect(isWorkflowActionDisabledByVeridian('LOGIC_FUNCTION')).toBe(true);
  });

  it("suit LOGIC_FUNCTION_TYPE quand il autorise l'exécution", () => {
    process.env.LOGIC_FUNCTION_TYPE = 'lambda';
    expect(isWorkflowActionDisabledByVeridian('CODE')).toBe(false);
  });

  it("refuse les étapes IA quand l'IA est coupée, seulement elle", () => {
    process.env.VERIDIAN_AI_DISABLED = 'true';
    expect(isWorkflowActionDisabledByVeridian('AI_AGENT')).toBe(true);
    expect(isWorkflowActionDisabledByVeridian('CLASSIFY')).toBe(true);
    delete process.env.VERIDIAN_AI_DISABLED;
    expect(isWorkflowActionDisabledByVeridian('AI_AGENT')).toBe(false);
  });

  it('laisse les étapes de données et HTTP', () => {
    process.env.VERIDIAN_AI_DISABLED = 'true';
    for (const type of [
      'CREATE_RECORD',
      'HTTP_REQUEST',
      'SEND_EMAIL',
      'FORM',
    ]) {
      expect(isWorkflowActionDisabledByVeridian(type)).toBe(false);
    }
  });
});
