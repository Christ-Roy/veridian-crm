import { Controller, Logger, Post, Req, Res } from '@nestjs/common';

import { type Request, type Response } from 'express';

import { sanitizeCspReports } from 'src/engine/core-modules/veridian-csp/utils/sanitize-csp-report.util';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_LOGS_PER_MINUTE = 120;

const readBody = (request: Request): Promise<string | null> =>
  new Promise((resolve) => {
    if (request.body !== undefined && Object.keys(request.body ?? {}).length > 0) {
      resolve(JSON.stringify(request.body));

      return;
    }

    let size = 0;
    const chunks: Buffer[] = [];

    request.on('data', (chunk: Buffer) => {
      size += chunk.length;

      if (size > MAX_BODY_BYTES) {
        resolve(null);
        request.destroy();

        return;
      }

      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', () => resolve(null));
  });

// VER-265: browsers post CSP violations here (report-uri). Public by nature, so the body is capped, every field is
// stripped of query strings and code samples, and logging is capped per minute.
@Controller()
export class VeridianCspController {
  private readonly logger = new Logger('VeridianCsp');
  private windowStart = 0;
  private logged = 0;
  private dropped = 0;

  @Post('api/csp')
  async report(@Req() request: Request, @Res() response: Response) {
    const body = await readBody(request);

    if (body === null) {
      return response.status(413).end();
    }

    let payload: unknown;

    try {
      payload = JSON.parse(body);
    } catch {
      return response.status(400).end();
    }

    const now = Date.now();

    if (now - this.windowStart > 60_000) {
      if (this.dropped > 0) {
        this.logger.warn(`csp_violation_dropped ${JSON.stringify({ count: this.dropped })}`);
      }
      this.windowStart = now;
      this.logged = 0;
      this.dropped = 0;
    }

    for (const violation of sanitizeCspReports(payload)) {
      if (this.logged >= MAX_LOGS_PER_MINUTE) {
        this.dropped += 1;
        continue;
      }
      this.logged += 1;
      this.logger.warn(`csp_violation ${JSON.stringify(violation)}`);
    }

    return response.status(204).end();
  }
}
