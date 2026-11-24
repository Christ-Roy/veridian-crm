import { isDefined } from 'twenty-shared/utils';

import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type NativeServices } from 'src/engine/core-modules/veridian-mcp-tools/native-services.service';
import { WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';

export const RECORD_NOT_READABLE = 'Record not found, or not readable by you';

// The native timelines only apply the mailbox and calendar visibility: a screen never opens on a record the caller cannot
// read, an assistant could ask for it. The read goes through the caller's role and record shares.
export const isRecordReadable = async (
  native: NativeServices,
  context: ToolProviderContext,
  objectNameSingular: string,
  recordId: string,
): Promise<boolean> => {
  const { authContext } = context;

  if (!isDefined(authContext) || authContext.type === 'system') {
    return false;
  }

  const ormManager = native.get(WorkspaceOrmManager);
  const record = await ormManager.executeInWorkspaceContext(
    () =>
      ormManager
        .getRepository(objectNameSingular)
        .findOne({ where: { id: recordId }, select: { id: true } }),
    authContext,
  );

  return isDefined(record);
};
