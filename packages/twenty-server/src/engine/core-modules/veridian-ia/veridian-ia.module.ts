import { Module } from '@nestjs/common';

import { LiensInstallationController } from 'src/engine/core-modules/veridian-ia/controllers/liens-installation.controller';
import { LiensInstallationService } from 'src/engine/core-modules/veridian-ia/services/liens-installation.service';

@Module({
  controllers: [LiensInstallationController],
  providers: [LiensInstallationService],
})
export class VeridianIaModule {}
