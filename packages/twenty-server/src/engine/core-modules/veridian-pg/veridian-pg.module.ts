import { Module } from '@nestjs/common';

import { DatabaseHealthController } from 'src/engine/core-modules/veridian-pg/controllers/database-health.controller';

@Module({
  controllers: [DatabaseHealthController],
})
export class VeridianPgModule {}
