import {
  type DocumentNode,
  type FieldNode,
  type OperationDefinitionNode,
  Kind,
  parse,
  visit,
} from 'graphql';

import { extractArgumentsFromAst } from 'src/engine/api/graphql/direct-execution/utils/extract-arguments-from-ast.util';
import { type ApiObjects } from 'src/engine/core-modules/veridian-mcp-api/utils/build-api-objects.util';
import { type ResolverNameMapEntry } from 'src/engine/api/graphql/direct-execution/utils/build-resolver-name-map.util';

export type ApiToolKind = 'lire' | 'ecrire' | 'supprimer';

export const API_LIMITS = {
  query: 20_000,
  tokens: 4_000,
  variables: 200_000,
  rootFields: 10,
  depth: 12,
  ids: 100,
  result: 200_000,
};

// The method behind a root field decides, never the name the caller gives. Restoring has its own tool (restore_records).
const METHODS: Record<ApiToolKind, ReadonlySet<string>> = {
  lire: new Set(['findMany', 'findOne', 'findDuplicates', 'groupBy']),
  ecrire: new Set(['createOne', 'createMany', 'updateOne', 'updateMany']),
  supprimer: new Set([
    'deleteOne',
    'deleteMany',
    'destroyOne',
    'destroyMany',
    'mergeMany',
  ]),
};

const BULK_BY_FILTER = new Set(['updateMany', 'deleteMany', 'destroyMany']);

const SECRET_FIELDS = new Set([
  'accessToken',
  'refreshToken',
  'connectionParameters',
  'syncCursor',
]);

export type ApiOperationCheck =
  | { ok: true; document: DocumentNode }
  | { ok: false; reason: string };

const no = (reason: string): ApiOperationCheck => ({ ok: false, reason });

const hasKey = (value: unknown, key: string): boolean => {
  if (Array.isArray(value)) {
    return value.some((item) => hasKey(item, key));
  }

  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return key in value || Object.values(value).some((item) => hasKey(item, key));
};

// A bulk write names its records: an empty or forgotten filter would reach the whole object.
const isFilterById = (filter: unknown): boolean => {
  if (typeof filter !== 'object' || filter === null) {
    return false;
  }

  const { id, ...others } = filter as { id?: { in?: unknown } };
  const ids = id?.in;

  return (
    Object.keys(others).length === 0 &&
    Object.keys(id ?? {}).join() === 'in' &&
    Array.isArray(ids) &&
    ids.length > 0 &&
    ids.length <= API_LIMITS.ids &&
    ids.every((item) => typeof item === 'string')
  );
};

const checkArguments = (
  method: string,
  kind: ApiToolKind,
  args: Record<string, unknown>,
): string | undefined => {
  if (BULK_BY_FILTER.has(method) && !isFilterById(args.filter)) {
    return `${method} needs filter: {id: {in: [...]}}, 1 to ${API_LIMITS.ids} ids.`;
  }

  if (
    method === 'createMany' &&
    (!Array.isArray(args.data) || args.data.length > API_LIMITS.ids)
  ) {
    return `createMany takes a list of ${API_LIMITS.ids} records at most.`;
  }

  // Writing deletedAt is deleting, or bringing back, under another name.
  if (kind === 'ecrire' && hasKey(args, 'deletedAt')) {
    return 'deletedAt cannot be written: use api_supprimer or restore_records.';
  }

  return undefined;
};

const checkShape = (operation: OperationDefinitionNode): string | undefined => {
  let reason: string | undefined;
  let depth = 0;

  visit(operation, {
    SelectionSet: {
      enter: () => {
        depth += 1;

        if (depth > API_LIMITS.depth) {
          reason ??= `Selection deeper than ${API_LIMITS.depth}.`;
        }
      },
      leave: () => {
        depth -= 1;
      },
    },
    FragmentSpread: () => {
      reason ??= 'Fragments are not supported: write the fields out.';
    },
    InlineFragment: () => {
      reason ??= 'Fragments are not supported: write the fields out.';
    },
    Directive: () => {
      reason ??= 'Directives are not supported.';
    },
    Field: (node) => {
      if (SECRET_FIELDS.has(node.name.value)) {
        reason ??= `${node.name.value} is never readable here.`;
      }
    },
  });

  return reason;
};

const CONNECTION_FIELDS = new Set(['edges', 'node', 'pageInfo']);

// Every relation followed must lead to a readable object: the root object is not the only one the answer shows.
const checkSelection = (
  node: FieldNode,
  objectUniversalIdentifier: string,
  objects: ApiObjects,
): string | undefined => {
  for (const selection of node.selectionSet?.selections ?? []) {
    const field = selection as FieldNode;
    const name = field.name.value;

    if (!field.selectionSet) {
      continue;
    }

    let next = objectUniversalIdentifier;

    if (!CONNECTION_FIELDS.has(name)) {
      const target = objects.get(objectUniversalIdentifier)?.fields.get(name);

      if (target === null) {
        continue;
      }

      if (target === undefined || !objects.get(target)?.readable) {
        return `The object behind ${name} is not readable here.`;
      }

      next = target;
    }

    const refusal = checkSelection(field, next, objects);

    if (refusal) {
      return refusal;
    }
  }

  return undefined;
};

// Only record operations of this workspace pass: a root field that is not one of them (auth, members, keys, roles, apps,
// settings, introspection) is not in the resolver map and is refused.
export const checkApiOperation = ({
  query,
  variables,
  kind,
  resolverNameMap,
  objects,
}: {
  query: string;
  variables: Record<string, unknown>;
  kind: ApiToolKind;
  resolverNameMap: Record<string, ResolverNameMapEntry>;
  objects: ApiObjects;
}): ApiOperationCheck => {
  if (
    query.length > API_LIMITS.query ||
    JSON.stringify(variables).length > API_LIMITS.variables
  ) {
    return no('Request too large.');
  }

  let document: DocumentNode;

  try {
    document = parse(query, {
      noLocation: true,
      maxTokens: API_LIMITS.tokens,
    });
  } catch {
    return no('Unreadable GraphQL.');
  }

  const [operation, ...others] = document.definitions;

  if (operation?.kind !== Kind.OPERATION_DEFINITION || others.length > 0) {
    return no('Exactly one operation, without fragments.');
  }

  if (operation.operation !== (kind === 'lire' ? 'query' : 'mutation')) {
    return no(
      kind === 'lire'
        ? 'api_lire only runs a query.'
        : `api_${kind} only runs a mutation.`,
    );
  }

  const shape = checkShape(operation);

  if (shape) {
    return no(shape);
  }

  const rootFields = operation.selectionSet.selections as readonly FieldNode[];

  if (rootFields.length > API_LIMITS.rootFields) {
    return no(`At most ${API_LIMITS.rootFields} root fields.`);
  }

  for (const field of rootFields) {
    const name = field.name.value;
    const entry: ResolverNameMapEntry | undefined = resolverNameMap[name];

    if (!entry || !METHODS[kind].has(entry.method)) {
      return no(`${name} is not allowed in api_${kind}.`);
    }

    const object = objects.get(entry.objectMetadataUniversalIdentifier);

    if (!(kind === 'lire' ? object?.readable : object?.writable)) {
      return no(`The object behind ${name} is not allowed here.`);
    }

    const refusal =
      checkArguments(
        entry.method,
        kind,
        extractArgumentsFromAst(field.arguments, variables),
      ) ??
      checkSelection(field, entry.objectMetadataUniversalIdentifier, objects);

    if (refusal) {
      return no(refusal);
    }
  }

  return { ok: true, document };
};
