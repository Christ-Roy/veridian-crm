import { Injectable } from '@nestjs/common';

import { type Request } from 'express';
import { isDefined } from 'twenty-shared/utils';
import { canObjectBeManagedByAutomation } from 'twenty-shared/workflow';

import { DirectExecutionService } from 'src/engine/api/graphql/direct-execution/direct-execution.service';
import { withWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { NativeServices } from 'src/engine/core-modules/veridian-mcp-tools/native-services.service';
import { failure } from 'src/engine/core-modules/veridian-mcp-tools/caller.util';
import {
  API_LIMITS,
  type ApiToolKind,
  checkApiOperation,
} from 'src/engine/core-modules/veridian-mcp-api/utils/check-api-operation.util';
import { getDatabaseCrudToolFlatObjects } from 'src/engine/metadata-modules/ai/ai-agent/utils/get-database-crud-tool-flat-objects.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

// The native direct execution runs the record resolvers as the caller: roles, field and row permissions, record shares,
// hooks and the trash stay those of the screen. Nothing here reads or writes by itself.
@Injectable()
export class VeridianApiRunnerService {
  constructor(private readonly native: NativeServices) {}

  async run({
    kind,
    query,
    variables = {},
    context: { authContext, workspaceId, locale },
  }: {
    kind: ApiToolKind;
    query: string;
    variables?: Record<string, unknown>;
    context: ToolProviderContext;
  }): Promise<ToolOutput> {
    // A human session only: never a key, an app, a system call or an action token.
    if (
      !isDefined(authContext) ||
      authContext.type !== 'user' ||
      authContext.workspace.id !== workspaceId
    ) {
      return failure('This tool acts for a signed-in member only.');
    }

    try {
      const { graphQLResolverNameMap, flatObjectMetadataMaps } =
        await this.native
          .get(WorkspaceCacheService)
          .getOrRecompute(workspaceId, [
            'graphQLResolverNameMap',
            'flatObjectMetadataMaps',
          ]);

      const allowed = new Set(
        getDatabaseCrudToolFlatObjects(
          flatObjectMetadataMaps.byUniversalIdentifier,
        )
          .filter(
            ({ nameSingular }) =>
              kind === 'lire' ||
              canObjectBeManagedByAutomation({ nameSingular }),
          )
          .map(({ universalIdentifier }) => universalIdentifier),
      );

      const check = checkApiOperation({
        query,
        variables,
        kind,
        resolverNameMap: graphQLResolverNameMap,
        isObjectAllowed: (universalIdentifier) =>
          allowed.has(universalIdentifier),
      });

      if (!check.ok) {
        return failure(check.reason);
      }

      const result = await withWorkspaceAuthContext(authContext, () =>
        this.native.get(DirectExecutionService).execute(
          {
            workspace: authContext.workspace,
            body: { query, variables },
            locale,
          } as unknown as Request,
          check.document,
          false,
          true,
        ),
      );

      if (!isDefined(result) || result.errors?.length) {
        return {
          ...failure(
            result?.errors?.map(({ message }) => message).join(' ; ') ??
              'Not executed',
          ),
          ...(result?.data ? { result: result.data } : {}),
        };
      }

      if (JSON.stringify(result.data).length > API_LIMITS.result) {
        return kind === 'lire'
          ? failure('Answer too large: ask for fewer records or fields.')
          : {
              success: true,
              message: 'Done. The answer is too large to be returned.',
            };
      }

      return { success: true, message: 'Done', result: result.data };
    } catch (error) {
      return failure('Could not run the operation', error);
    }
  }
}
