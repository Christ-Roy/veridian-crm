import { Injectable, type Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

// Veridian: the native services answer to the resolvers' own instances. Most of their modules export nothing, so they are
// looked up by class instead of patching each module upstream.
@Injectable()
export class NativeServices {
  constructor(private readonly moduleRef: ModuleRef) {}

  get<T>(service: Type<T>): T {
    return this.moduleRef.get(service, { strict: false });
  }
}
