/*
 * Veridian CRM — Custom domain (white-label) clean-room module.
 * Copyright (c) 2026-present Veridian. Licensed under AGPLv3.
 */

import { ArgsType, Field } from '@nestjs/graphql';

import { IsFQDN, IsNotEmpty, IsString } from 'class-validator';

@ArgsType()
export class SetVeridianCustomDomainInput {
  /**
   * Le domaine custom du client, ex. "crm.client.com".
   * `IsFQDN` valide la forme d'un nom de domaine pleinement qualifié et bloque
   * les inputs vides / IPs / hosts non routables — premier filet anti-abus
   * avant même de toucher le DNS.
   */
  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @IsFQDN()
  domain: string;
}
