import {
  Controller,
  Get,
  HttpCode,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';

const DATABASE_CHECK_TIMEOUT_MS = 2000;

// The native /healthz checks nothing: during the pg-saas failover of 09/11/2026 it stayed green while
// every page failed. Nomad and Traefik probe this route so an instance without its database is not served.
@Controller('healthz/base')
export class DatabaseHealthController {
  constructor(
    @InjectDataSource()
    private readonly coreDataSource: DataSource,
  ) {}

  @Get()
  @HttpCode(200)
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async check() {
    let timer: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        this.coreDataSource.query('SELECT 1'),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('database check timed out')),
            DATABASE_CHECK_TIMEOUT_MS,
          );
        }),
      ]);

      return { status: 'ok', database: 'up' };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'down',
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
