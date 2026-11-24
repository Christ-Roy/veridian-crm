import { WorkspaceMemberIdentityPreQueryHook } from 'src/engine/core-modules/veridian-hub-sso/query-hooks/workspace-member-identity.pre-query.hook';
import { PermissionsException } from 'src/engine/permissions/permissions.exception';

describe('WorkspaceMemberIdentityPreQueryHook', () => {
  const hook = new WorkspaceMemberIdentityPreQueryHook();
  const run = (data: object) =>
    hook.execute({} as never, 'workspaceMember', { id: 'x', data } as never);

  it('refuses a rename', async () => {
    await expect(run({ name: { firstName: 'X' } })).rejects.toThrow(
      PermissionsException,
    );
  });

  it('refuses an email change', async () => {
    await expect(run({ userEmail: 'x@y.fr' })).rejects.toThrow(
      PermissionsException,
    );
  });

  it('refuses to point the record at another account', async () => {
    await expect(
      run({ userId: '0b9f3c1e-7d2a-4c55-9f1e-2a6b8c4d5e6f' }),
    ).rejects.toThrow(PermissionsException);
  });

  it('lets other preferences through', async () => {
    await expect(run({ colorScheme: 'Dark' })).resolves.toBeDefined();
  });
});
