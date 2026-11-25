import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TokenModule } from 'src/engine/core-modules/auth/token/token.module';
import { KeyValuePairEntity } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { SecretEncryptionModule } from 'src/engine/core-modules/secret-encryption/secret-encryption.module';
import { VeridianDelegationController } from 'src/engine/core-modules/veridian-delegation/controllers/veridian-delegation.controller';
import { VeridianDelegationService } from 'src/engine/core-modules/veridian-delegation/services/veridian-delegation.service';
import { VeridianGrantService } from 'src/engine/core-modules/veridian-delegation/services/veridian-grant.service';
import { WorkspaceCacheStorageModule } from 'src/engine/workspace-cache-storage/workspace-cache-storage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([KeyValuePairEntity]),
    TokenModule,
    SecretEncryptionModule,
    WorkspaceCacheStorageModule,
  ],
  controllers: [VeridianDelegationController],
  providers: [VeridianDelegationService, VeridianGrantService],
  exports: [VeridianGrantService],
})
export class VeridianDelegationModule {}
