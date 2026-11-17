import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

const id = () => ({ type: 'char' as const, length: 36 });

@Entity('auth_credentials')
export class AuthCredential {
  @PrimaryColumn(id()) id!: string;
  @Index({ unique: true }) @Column({ type: 'varchar', length: 254 }) email!: string;
  @Index({ unique: true }) @Column({ type: 'varchar', length: 20 }) phone!: string;
  @Column({ name: 'password_hash', type: 'varchar', length: 100 }) passwordHash!: string;
  @Column({ name: 'two_factor_secret', type: 'varchar', length: 255, nullable: true }) twoFactorSecret!: string | null;
  @Column({ name: 'two_factor_enabled', type: 'boolean', default: false }) twoFactorEnabled!: boolean;
  @Column({ type: 'varchar', length: 16, default: 'active' }) status!: 'active' | 'disabled';
  @Column({ name: 'password_changed_at', type: 'datetime', nullable: true }) passwordChangedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt!: Date;
}

@Entity('auth_sessions')
export class AuthSession {
  @PrimaryColumn(id()) id!: string;
  @Index() @Column({ name: 'user_id', ...id() }) userId!: string;
  @Index({ unique: true }) @Column({ name: 'refresh_token_hash', type: 'char', length: 64 }) refreshTokenHash!: string;
  @Column({ name: 'expires_at', type: 'datetime' }) expiresAt!: Date;
  @Column({ name: 'revoked_at', type: 'datetime', nullable: true }) revokedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt!: Date;
}

@Entity('auth_login_limits')
export class AuthLoginLimit {
  @PrimaryColumn({ name: 'identifier_hash', type: 'char', length: 64 }) identifierHash!: string;
  @PrimaryColumn({ name: 'window_start', type: 'datetime' }) windowStart!: Date;
  @Column({ name: 'attempt_count', type: 'int', default: 0 }) attemptCount!: number;
}

@Entity('password_resets')
export class PasswordReset {
  @PrimaryColumn(id()) id!: string;
  @Index({ unique: true }) @Column({ name: 'token_hash', type: 'char', length: 64 }) tokenHash!: string;
  @Index() @Column({ name: 'user_id', ...id() }) userId!: string;
  @Column({ name: 'expires_at', type: 'datetime' }) expiresAt!: Date;
  @Column({ name: 'used_at', type: 'datetime', nullable: true }) usedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt!: Date;
}

@Entity('login_attempts')
@Index(['identifierHash', 'createdAt'])
export class LoginAttempt {
  @PrimaryColumn(id()) id!: string;
  @Column({ name: 'identifier_hash', type: 'char', length: 64 }) identifierHash!: string;
  @Column({ type: 'boolean' }) successful!: boolean;
  @Column({ name: 'ip_hash', type: 'char', length: 64 }) ipHash!: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt!: Date;
}

@Entity('user_profiles')
export class UserProfile {
  @PrimaryColumn(id()) id!: string;
  @Column({ name: 'first_name', type: 'varchar', length: 80 }) firstName!: string;
  @Column({ name: 'last_name', type: 'varchar', length: 80 }) lastName!: string;
  @Column({ type: 'varchar', length: 254 }) email!: string;
  @Column({ type: 'varchar', length: 20 }) phone!: string;
  @Column({ type: 'varchar', length: 16, default: 'active' }) status!: 'active' | 'disabled';
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt!: Date;
}

@Entity('wallets')
@Index(['ownerId', 'createdAt'])
export class Wallet {
  @PrimaryColumn(id()) id!: string;
  @Column({ name: 'owner_id', ...id() }) ownerId!: string;
  @Column({ type: 'char', length: 3, default: 'GTQ' }) currency!: string;
  @Column({ type: 'varchar', length: 16, default: 'active' }) status!: 'active' | 'suspended' | 'closed';
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, nullable: true, unique: true }) idempotencyKey!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt!: Date;
}

@Entity('financial_accounts')
export class FinancialAccount {
  @PrimaryColumn(id()) id!: string;
  @Index() @Column({ name: 'owner_id', ...id() }) ownerId!: string;
  @Column({ type: 'char', length: 3, default: 'GTQ' }) currency!: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, default: '0.00' }) balance!: string;
  @Column({ type: 'varchar', length: 16, default: 'active' }) status!: 'active' | 'suspended' | 'closed' | 'disabled';
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt!: Date;
}

@Entity('transfers')
@Index(['senderId', 'createdAt'])
@Index(['recipientId', 'createdAt'])
export class Transfer {
  @PrimaryColumn(id()) id!: string;
  @Column({ name: 'sender_id', ...id() }) senderId!: string;
  @Column({ name: 'recipient_id', ...id() }) recipientId!: string;
  @Column({ type: 'decimal', precision: 18, scale: 2 }) amount!: string;
  @Column({ type: 'char', length: 3, default: 'GTQ' }) currency!: string;
  @Column({ type: 'varchar', length: 16, default: 'confirmed' }) status!: string;
  @Index({ unique: true }) @Column({ name: 'idempotency_key', type: 'varchar', length: 128 }) idempotencyKey!: string;
  @Column({ name: 'request_hash', type: 'char', length: 64 }) requestHash!: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt!: Date;
}

@Entity('test_wallet_fundings')
@Index(['walletId', 'createdAt'])
export class TestWalletFunding {
  @PrimaryColumn(id()) id!: string;
  @Column({ name: 'actor_id', ...id() }) actorId!: string;
  @Column({ name: 'wallet_id', ...id() }) walletId!: string;
  @Column({ type: 'decimal', precision: 18, scale: 2 }) amount!: string;
  @Column({ name: 'balance_after', type: 'decimal', precision: 18, scale: 2 }) balanceAfter!: string;
  @Column({ type: 'char', length: 3, default: 'GTQ' }) currency!: string;
  @Index({ unique: true }) @Column({ name: 'idempotency_key', type: 'varchar', length: 128 }) idempotencyKey!: string;
  @Column({ name: 'request_hash', type: 'char', length: 64 }) requestHash!: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt!: Date;
}

@Entity('ledger_entries')
@Index(['transferId', 'walletId'], { unique: true })
export class LedgerEntry {
  @PrimaryColumn(id()) id!: string;
  @Column({ name: 'transfer_id', ...id() }) transferId!: string;
  @Index() @Column({ name: 'wallet_id', ...id() }) walletId!: string;
  @Column({ type: 'varchar', length: 8 }) direction!: 'debit' | 'credit';
  @Column({ type: 'decimal', precision: 18, scale: 2 }) amount!: string;
  @Column({ type: 'char', length: 3, default: 'GTQ' }) currency!: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt!: Date;
}

@Entity('outbox_events')
@Index(['publishedAt', 'createdAt'])
export class OutboxEvent {
  @PrimaryColumn(id()) id!: string;
  @Column({ name: 'event_type', type: 'varchar', length: 80 }) eventType!: string;
  @Column({ name: 'aggregate_id', ...id() }) aggregateId!: string;
  @Column({ type: 'json' }) payload!: Record<string, unknown>;
  @Column({ name: 'published_at', type: 'datetime', nullable: true }) publishedAt!: Date | null;
  @Column({ name: 'attempts', type: 'int', default: 0 }) attempts!: number;
  @Column({ name: 'next_attempt_at', type: 'datetime', nullable: true }) nextAttemptAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt!: Date;
}

@Entity('notifications')
@Index(['eventId', 'recipientId', 'channel'], { unique: true })
export class NotificationRecord {
  @PrimaryColumn(id()) id!: string;
  @Column({ name: 'event_id', ...id() }) eventId!: string;
  @Column({ name: 'recipient_id', ...id() }) recipientId!: string;
  @Column({ type: 'varchar', length: 16, default: 'in_app' }) channel!: string;
  @Column({ type: 'json' }) payload!: Record<string, unknown>;
  @Column({ type: 'varchar', length: 16, default: 'pending' }) status!: string;
  @Column({ name: 'attempts', type: 'int', default: 0 }) attempts!: number;
  @Column({ name: 'next_attempt_at', type: 'datetime', nullable: true }) nextAttemptAt!: Date | null;
  @Column({ name: 'sent_at', type: 'datetime', nullable: true }) sentAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt!: Date;
}

@Entity('notification_preferences')
@Index(['userId', 'channel'], { unique: true })
export class NotificationPreference {
  @PrimaryColumn(id()) id!: string;
  @Column({ name: 'user_id', ...id() }) userId!: string;
  @Column({ type: 'varchar', length: 16 }) channel!: string;
  @Column({ type: 'boolean', default: true }) enabled!: boolean;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt!: Date;
}

@Entity('transfer_projections')
@Index(['userId', 'createdAt'])
export class TransferProjection {
  @PrimaryColumn(id()) id!: string;
  @Column({ name: 'user_id', ...id() }) userId!: string;
  @Column({ name: 'transfer_id', ...id() }) transferId!: string;
  @Column({ name: 'counterparty_id', ...id() }) counterpartyId!: string;
  @Column({ type: 'varchar', length: 8 }) direction!: 'sent' | 'received';
  @Column({ type: 'decimal', precision: 18, scale: 2 }) amount!: string;
  @Column({ type: 'char', length: 3 }) currency!: string;
  @Column({ type: 'varchar', length: 16 }) status!: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt!: Date;
}

@Entity('processed_events')
@Index(['consumer', 'eventId'], { unique: true })
export class ProcessedEvent {
  @PrimaryColumn(id()) id!: string;
  @Column({ type: 'varchar', length: 24 }) consumer!: string;
  @Column({ name: 'event_id', type: 'char', length: 36 }) eventId!: string;
  @CreateDateColumn({ name: 'processed_at', type: 'datetime' }) processedAt!: Date;
}

@Entity('audit_events')
@Index(['actorId', 'createdAt'])
export class AuditEvent {
  @PrimaryColumn(id()) id!: string;
  @Column({ name: 'actor_id', type: 'char', length: 36, nullable: true }) actorId!: string | null;
  @Column({ type: 'varchar', length: 80 }) action!: string;
  @Column({ name: 'target_id', type: 'char', length: 36, nullable: true }) targetId!: string | null;
  @Column({ type: 'json', nullable: true }) metadata!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt!: Date;
}

@Entity('gateway_rate_limits')
export class GatewayRateLimit {
  @PrimaryColumn({ name: 'ip_hash', type: 'char', length: 64 }) ipHash!: string;
  @PrimaryColumn({ name: 'window_start', type: 'datetime' }) windowStart!: Date;
  @Column({ name: 'request_count', type: 'int', default: 0 }) requestCount!: number;
}

export const entities = [
  AuthCredential, AuthSession, PasswordReset, LoginAttempt, AuthLoginLimit, UserProfile, Wallet,
  FinancialAccount, Transfer, TestWalletFunding, LedgerEntry, OutboxEvent, NotificationRecord,
  NotificationPreference, TransferProjection, ProcessedEvent, AuditEvent, GatewayRateLimit,
];