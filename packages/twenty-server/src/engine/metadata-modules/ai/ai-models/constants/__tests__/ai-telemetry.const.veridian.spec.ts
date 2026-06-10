import { AI_TELEMETRY_CONFIG } from 'src/engine/metadata-modules/ai/ai-models/constants/ai-telemetry.const';

// Veridian patch-survival: AI prompt inputs/outputs must never be recorded
// in telemetry spans (see VERIDIAN-PATCHES.md). A careless upstream sync
// could flip these back to true.
describe('veridian-patch: AI_TELEMETRY_CONFIG never records prompts', () => {
  it('keeps recordInputs and recordOutputs false', () => {
    expect(AI_TELEMETRY_CONFIG.recordInputs).toBe(false);
    expect(AI_TELEMETRY_CONFIG.recordOutputs).toBe(false);
  });
});
