import { Field, InputType, Int } from '@nestjs/graphql';

import { IsDate, IsInt, IsOptional, IsString, IsUUID } from 'class-validator';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@InputType()
export class VeridianAuditLogFilterInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  action?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  targetType?: string;

  @Field(() => UUIDScalarType, { nullable: true })
  @IsOptional()
  @IsUUID()
  targetId?: string;

  @Field(() => UUIDScalarType, { nullable: true })
  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  @IsDate()
  from?: Date;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  @IsDate()
  to?: Date;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  @IsDate()
  before?: Date;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  limit?: number;
}
