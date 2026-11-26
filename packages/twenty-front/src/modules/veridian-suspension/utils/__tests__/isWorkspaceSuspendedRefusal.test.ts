import { CombinedGraphQLErrors } from '@apollo/client/errors';

import { isWorkspaceSuspendedRefusal } from '@/veridian-suspension/utils/isWorkspaceSuspendedRefusal';

const refus = (extensions: Record<string, unknown>) =>
  new CombinedGraphQLErrors({
    errors: [{ message: 'Workspace is suspended', extensions }],
  });

describe('isWorkspaceSuspendedRefusal', () => {
  it('reconnaît le refus de suspension', () => {
    expect(
      isWorkspaceSuspendedRefusal(
        refus({ code: 'FORBIDDEN', subCode: 'WORKSPACE_SUSPENDED' }),
      ),
    ).toBe(true);
  });

  it("ne prend pas un autre refus pour une suspension", () => {
    expect(
      isWorkspaceSuspendedRefusal(
        refus({ code: 'FORBIDDEN', subCode: 'FORBIDDEN_EXCEPTION' }),
      ),
    ).toBe(false);
    expect(isWorkspaceSuspendedRefusal(new Error('réseau'))).toBe(false);
    expect(isWorkspaceSuspendedRefusal(undefined)).toBe(false);
  });
});
