import { Field, ObjectType } from '@nestjs/graphql';

import { IDField } from '@ptc-org/nestjs-query-graphql';
import GraphQLJSON from 'graphql-type-json';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import {
  type VeridianAuditLogActorType,
  VeridianAuditLogActorTypeEnum,
} from 'src/engine/core-modules/veridian-audit-log/constants/veridian-audit-log.constants';

/**
 * Veridian append-only audit log (AGPL — clean-room, no EE code).
 *
 * One row = one auditable event (record CRUD, auth, role change…). The row is
 * NEVER updated or deleted by application code: the only write is INSERT, the
 * only delete is the bounded retention purge. There is intentionally no FK
 * CASCADE to the workspace so an audit trail outlives the deletion of the
 * workspace it describes (legal retention).
 */
@Index('IDX_VERIDIAN_AUDIT_LOG_WORKSPACE_RECORDED', [
  'workspaceId',
  'recordedAt',
])
@Index('IDX_VERIDIAN_AUDIT_LOG_TARGET', [
  'workspaceId',
  'targetType',
  'targetId',
])
@Index('IDX_VERIDIAN_AUDIT_LOG_ACTOR', ['workspaceId', 'actorUserId'])
@Index('IDX_VERIDIAN_AUDIT_LOG_ACTION', ['workspaceId', 'action'])
@Entity({ name: 'veridianAuditLog', schema: 'core' })
@ObjectType('VeridianAuditLog')
export class VeridianAuditLogEntity {
  @IDField(() => UUIDScalarType)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // No FK CASCADE on purpose — see class doc.
  @Field(() => UUIDScalarType, { nullable: true })
  @Column({ type: 'uuid', nullable: true })
  workspaceId: string | null;

  @Field()
  @Column({ type: 'varchar' })
  action: string;

  @Field({ nullable: true })
  @Column({ type: 'varchar', nullable: true })
  targetType?: string | null;

  @Field(() => UUIDScalarType, { nullable: true })
  @Column({ type: 'uuid', nullable: true })
  targetId?: string | null;

  @Field(() => UUIDScalarType, { nullable: true })
  @Column({ type: 'uuid', nullable: true })
  actorUserId?: string | null;

  @Field(() => UUIDScalarType, { nullable: true })
  @Column({ type: 'uuid', nullable: true })
  actorWorkspaceMemberId?: string | null;

  @Field(() => String)
  @Column({ type: 'varchar', default: VeridianAuditLogActorTypeEnum.SYSTEM })
  actorType: VeridianAuditLogActorType;

  @Field({ nullable: true })
  @Column({ type: 'varchar', nullable: true })
  actorDisplay?: string | null;

  @Field({ nullable: true })
  @Column({ type: 'varchar', nullable: true })
  ipAddress?: string | null;

  @Field({ nullable: true })
  @Column({ type: 'varchar', nullable: true })
  userAgent?: string | null;

  @Field(() => GraphQLJSON, { nullable: true })
  @Column({ type: 'jsonb', nullable: true })
  context?: Record<string, unknown> | null;

  @Field(() => GraphQLJSON, { nullable: true })
  @Column({ type: 'jsonb', nullable: true })
  diff?: Record<string, unknown> | null;

  @Field(() => Date)
  @CreateDateColumn({ type: 'timestamptz' })
  recordedAt: Date;

  @Field(() => Date, { nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  occurredAt?: Date | null;
}
