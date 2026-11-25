import { setTimeout } from 'node:timers/promises';

import {
  type CoreEntityCacheService,
  MEMOIZER_TTL_MS,
} from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { type CoreEntityCacheKeyName } from 'src/engine/core-entity-cache/types/core-entity-cache-key.type';

// A read in flight when the row changes writes the old one back after the invalidation.
export const IN_FLIGHT_READ_MS = 1500;

// Once resolved, it is done in every process: the stale write is gone, then every memory of it has expired.
export const settleCoreEntityCache = async (
  coreEntityCacheService: CoreEntityCacheService,
  cacheKeyName: CoreEntityCacheKeyName,
  entityIds: string[],
): Promise<void> => {
  await setTimeout(IN_FLIGHT_READ_MS);

  for (const entityId of entityIds) {
    await coreEntityCacheService.invalidate(cacheKeyName, entityId);
  }

  await setTimeout(MEMOIZER_TTL_MS);
};
