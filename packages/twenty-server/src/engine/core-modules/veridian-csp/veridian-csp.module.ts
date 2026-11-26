import { Module } from '@nestjs/common';

import { VeridianCspController } from 'src/engine/core-modules/veridian-csp/controllers/veridian-csp.controller';

@Module({
  controllers: [VeridianCspController],
})
export class VeridianCspModule {}
