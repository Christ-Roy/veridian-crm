import { Injectable, type NestMiddleware } from '@nestjs/common';

import { type NextFunction, type Request, type Response } from 'express';

import { JSON_RPC_ERROR_CODE } from 'src/engine/api/mcp/constants/json-rpc-error-code.const';
import { VeridianHubMcpAuthService } from 'src/engine/core-modules/veridian-hub-mcp/services/veridian-hub-mcp-auth.service';

const BEARER_PREFIX = 'Bearer ';

// A Hub JWT is swapped for the user's own Twenty access token before the native MCP guard runs,
// so tools, permissions and audit stay those of Twenty. Any other token passes through untouched.
@Injectable()
export class VeridianHubMcpAuthMiddleware implements NestMiddleware {
  constructor(private readonly hubMcpAuthService: VeridianHubMcpAuthService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const header = req.headers.authorization;

    if (!header?.startsWith(BEARER_PREFIX)) {
      next();

      return;
    }

    const result = await this.hubMcpAuthService.authenticate(
      header.slice(BEARER_PREFIX.length).trim(),
    );

    if (result.kind === 'not_hub') {
      next();

      return;
    }

    if (result.kind === 'refused') {
      res.status(result.status).json({
        jsonrpc: '2.0',
        error: {
          code: JSON_RPC_ERROR_CODE.INVALID_REQUEST,
          message: result.message,
          data: { error: result.error },
        },
        id: req.body?.id ?? null,
      });

      return;
    }

    req.headers.authorization = `${BEARER_PREFIX}${result.accessToken}`;
    next();
  }
}
