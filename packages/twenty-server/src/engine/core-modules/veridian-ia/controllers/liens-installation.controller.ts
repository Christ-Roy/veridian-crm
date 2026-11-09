import { Controller, Get, UseGuards } from '@nestjs/common';

import { LiensInstallationService } from 'src/engine/core-modules/veridian-ia/services/liens-installation.service';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';

// Public on purpose: the Hub serves the same links publicly, they carry no secret and no identity.
@Controller('veridian/ia/liens')
export class LiensInstallationController {
  constructor(
    private readonly liensInstallationService: LiensInstallationService,
  ) {}

  @Get()
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  get() {
    return this.liensInstallationService.get();
  }
}
