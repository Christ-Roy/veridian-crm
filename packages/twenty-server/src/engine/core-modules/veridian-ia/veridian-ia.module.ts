import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { KeyValuePairEntity } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { LiensInstallationController } from 'src/engine/core-modules/veridian-ia/controllers/liens-installation.controller';
import { IdentiteIaService } from 'src/engine/core-modules/veridian-ia/services/identite-ia.service';
import { LiensInstallationService } from 'src/engine/core-modules/veridian-ia/services/liens-installation.service';

@Module({
  imports: [TypeOrmModule.forFeature([KeyValuePairEntity, UserWorkspaceEntity])],
  controllers: [LiensInstallationController],
  providers: [LiensInstallationService, IdentiteIaService],
})
export class VeridianIaModule {}
