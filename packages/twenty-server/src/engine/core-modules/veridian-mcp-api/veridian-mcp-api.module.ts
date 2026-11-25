import { Module } from '@nestjs/common';

import { VeridianApiRunnerService } from 'src/engine/core-modules/veridian-mcp-api/api-runner.service';
import { ApiEcrireTool } from 'src/engine/core-modules/veridian-mcp-api/tools/api-ecrire.tool';
import { ApiLireTool } from 'src/engine/core-modules/veridian-mcp-api/tools/api-lire.tool';
import { ApiSupprimerTool } from 'src/engine/core-modules/veridian-mcp-api/tools/api-supprimer.tool';
import { NativeServices } from 'src/engine/core-modules/veridian-mcp-tools/native-services.service';

@Module({
  providers: [
    NativeServices,
    VeridianApiRunnerService,
    ApiLireTool,
    ApiEcrireTool,
    ApiSupprimerTool,
  ],
})
export class VeridianMcpApiModule {}
