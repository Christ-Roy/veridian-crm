import { Injectable, Logger } from '@nestjs/common';

import {
  type LiensInstallation,
  parseLiensInstallation,
} from 'src/engine/core-modules/veridian-ia/utils/parse-liens-installation.util';

const FRESH_MS = 5 * 60 * 1000;
const STALE_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;

export type LiensInstallationReponse =
  | ({ disponible: true } & LiensInstallation)
  | { disponible: false };

@Injectable()
export class LiensInstallationService {
  private readonly logger = new Logger(LiensInstallationService.name);
  private cache: { liens: LiensInstallation; fetchedAt: number } | null = null;

  async get(): Promise<LiensInstallationReponse> {
    const age = this.cache ? Date.now() - this.cache.fetchedAt : Infinity;

    if (this.cache && age < FRESH_MS) {
      return { disponible: true, ...this.cache.liens };
    }

    const liens = await this.fetchFromHub();

    if (liens) {
      this.cache = { liens, fetchedAt: Date.now() };

      return { disponible: true, ...liens };
    }

    // The Hub is down: links known within the hour still work, otherwise no button at all.
    if (this.cache && age < STALE_MS) {
      return { disponible: true, ...this.cache.liens };
    }

    return { disponible: false };
  }

  private async fetchFromHub(): Promise<LiensInstallation | null> {
    const hubUrl = process.env.HUB_URL;

    if (!hubUrl) {
      return null;
    }

    try {
      const response = await fetch(
        `${hubUrl.replace(/\/+$/, '')}/api/mcp/liens-installation?app=twenty`,
        { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );

      if (!response.ok) {
        this.logger.warn(`Hub install links: HTTP ${response.status}`);

        return null;
      }

      const liens = parseLiensInstallation(await response.json(), (rejete) =>
        // Visible in obs: a button the Hub serves but Twenty does not show.
        this.logger.warn(
          `Hub install link dropped: cle=${rejete.cle} origine=${rejete.origine}`,
        ),
      );

      if (!liens) {
        this.logger.warn('Hub install links: unexpected shape, ignored');
      }

      return liens;
    } catch (error) {
      this.logger.warn(
        `Hub install links unreachable: ${error instanceof Error ? error.message : error}`,
      );

      return null;
    }
  }
}
