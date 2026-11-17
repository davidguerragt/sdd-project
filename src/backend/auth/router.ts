import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import nodemailer from 'nodemailer';
import { Router } from 'express';
import { IsNull, MoreThan } from 'typeorm';
import { z } from 'zod';
import { database } from '../shared/database';
import { AuthCredential, AuthSession, LoginAttempt, PasswordReset } from '../shared/entities';
import {
  asyncRoute, authenticate, AuthenticatedRequest, audit, digest, emailSchema,
  phoneSchema, requireInternal, requireUser, requiredEnv, signAccessToken,
} from '../shared/security';

export const authRouter = Router();
const genericLoginError = { error: 'invalid_credentials' };
const dummyPasswordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);
const registerSchema = z.object({
  email: emailSchema,
  phone: phoneSchema,
  password: z.string().min(12).max(128),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
});

function encryptSecret(secret: string): string {
  const key = Buffer.from(requiredEnv('TOTP_ENCRYPTION_KEY'), 'hex');
  if (key.length !== 32) throw new Error('TOTP_ENCRYPTION_KEY must be 32 bytes encoded as hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(value: string): string {
  const [ivHex, tagHex, encryptedHex] = value.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(requiredEnv('TOTP_ENCRYPTION_KEY'), 'hex'), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]).toString('utf8');
}

async function createSession(userId: string) {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  await database.getRepository(AuthSession).insert({
    id: crypto.randomUUID(), userId, refreshTokenHash: digest(refreshToken),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), revokedAt: null,
  });
  return { accessToken: signAccessToken(userId), refreshToken, tokenType: 'Bearer', expiresIn: 600 };
}

authRouter.post('/register', asyncRoute(async (request, response) => {
  const input = registerSchema.parse(request.body);
  const repo = database.getRepository(AuthCredential);
  if (await repo.exist({ where: [{ email: input.email }, { phone: input.phone }] })) {
    response.status(409).json({ error: 'identifier_already_registered' });
    return;
  }

  const userId = crypto.randomUUID();
  const usersUrl = process.env.USERS_SERVICE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  const profileResponse = await fetch(`${usersUrl}/users/internal/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-service-token': requiredEnv('INTERNAL_SERVICE_TOKEN') },
    body: JSON.stringify({ id: userId, email: input.email, phone: input.phone, firstName: input.firstName, lastName: input.lastName }),
  });
  if (!profileResponse.ok) {
    response.status(profileResponse.status === 409 ? 409 : 503).json({ error: profileResponse.status === 409 ? 'identifier_already_registered' : 'user_service_unavailable' });
    return;
  }

  try {
    await repo.insert({
      id: userId, email: input.email, phone: input.phone,
      passwordHash: await bcrypt.hash(input.password, 12), twoFactorSecret: null,
      twoFactorEnabled: false, status: 'active', passwordChangedAt: null,
    });
  } catch (error) {
    await fetch(`${usersUrl}/users/internal/users/${userId}`, {
      method: 'DELETE', headers: { 'x-internal-service-token': requiredEnv('INTERNAL_SERVICE_TOKEN') },
    }).catch(() => undefined);
    throw error;
  }

  await audit('auth.register', userId, userId);
  response.status(201).json({ userId });
}));

authRouter.post('/login', asyncRoute(async (request, response) => {
  const input = z.object({ identifier: z.string().trim().min(1).max(254), password: z.string().min(1).max(128), otp: z.string().length(6).optional() }).parse(request.body);
  const identifier = input.identifier.includes('@') ? input.identifier.toLowerCase() : input.identifier;
  const identifierHash = digest(identifier);
  const windowStart = new Date(Math.floor(Date.now() / (15 * 60 * 1000)) * (15 * 60 * 1000));
  await database.query(
    'INSERT INTO auth_login_limits (identifier_hash, window_start, attempt_count) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE attempt_count = attempt_count + 1',
    [identifierHash, windowStart],
  );
  const [limit] = await database.query(
    'SELECT attempt_count AS attemptCount FROM auth_login_limits WHERE identifier_hash = ? AND window_start = ?',
    [identifierHash, windowStart],
  ) as Array<{ attemptCount: number }>;
  if (Number(limit?.attemptCount ?? 0) > 5) {
    response.status(401).json(genericLoginError);
    return;
  }

  const credential = await database.getRepository(AuthCredential).findOne({ where: [{ email: identifier }, { phone: identifier }] });
  const passwordMatches = await bcrypt.compare(input.password, credential?.passwordHash ?? dummyPasswordHash);
  let valid = Boolean(credential && credential.status === 'active' && passwordMatches);
  if (valid && credential?.twoFactorEnabled) {
    valid = Boolean(input.otp && credential.twoFactorSecret && authenticator.check(input.otp, decryptSecret(credential.twoFactorSecret)));
  }
  await database.getRepository(LoginAttempt).insert({
    id: crypto.randomUUID(), identifierHash, ipHash: digest(request.ip ?? ''), successful: valid,
  });
  if (!valid || !credential) {
    await audit('auth.login.failed', credential?.id ?? null);
    response.status(401).json(genericLoginError);
    return;
  }

  await audit('auth.login.succeeded', credential.id, credential.id);
  response.json(await createSession(credential.id));
}));

authRouter.post('/refresh', asyncRoute(async (request, response) => {
  const { refreshToken } = z.object({ refreshToken: z.string().min(32).max(128) }).parse(request.body);
  const rotation = await database.transaction(async (manager) => {
    const repo = manager.getRepository(AuthSession);
    const session = await repo.createQueryBuilder('session').setLock('pessimistic_write')
      .where('session.refreshTokenHash = :hash', { hash: digest(refreshToken) })
      .andWhere('session.revokedAt IS NULL').andWhere('session.expiresAt > :now', { now: new Date() }).getOne();
    if (!session || !(await manager.getRepository(AuthCredential).exist({ where: { id: session.userId, status: 'active' } }))) return null;
    const nextRefreshToken = crypto.randomBytes(48).toString('base64url');
    await repo.update(session.id, { revokedAt: new Date() });
    await repo.insert({
      id: crypto.randomUUID(), userId: session.userId, refreshTokenHash: digest(nextRefreshToken),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), revokedAt: null,
    });
    return { userId: session.userId, refreshToken: nextRefreshToken };
  });
  if (!rotation) {
    response.status(401).json({ error: 'invalid_session' });
    return;
  }
  response.json({ accessToken: signAccessToken(rotation.userId), refreshToken: rotation.refreshToken, tokenType: 'Bearer', expiresIn: 600 });
}));

authRouter.post('/logout', asyncRoute(async (request, response) => {
  const { refreshToken } = z.object({ refreshToken: z.string().min(32).max(128) }).parse(request.body);
  const repo = database.getRepository(AuthSession);
  const session = await repo.findOne({ where: { refreshTokenHash: digest(refreshToken), revokedAt: IsNull() } });
  if (session) {
    await repo.update(session.id, { revokedAt: new Date() });
    await audit('auth.logout', session.userId, session.userId);
  }
  response.status(204).end();
}));

authRouter.post('/password/forgot', asyncRoute(async (request, response) => {
  const { email } = z.object({ email: emailSchema }).parse(request.body);
  const credential = await database.getRepository(AuthCredential).findOne({ where: { email, status: 'active' } });
  if (credential) {
    const recentRequests = await database.getRepository(PasswordReset).count({
      where: { userId: credential.id, createdAt: MoreThan(new Date(Date.now() - 60 * 60 * 1000)) },
    });
    if (recentRequests >= 3) {
      response.status(202).json({ message: 'If the account exists, recovery instructions will be sent.' });
      return;
    }
    const rawToken = crypto.randomBytes(32).toString('base64url');
    await database.getRepository(PasswordReset).insert({
      id: crypto.randomUUID(), userId: credential.id, tokenHash: digest(rawToken),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), usedAt: null,
    });
    await audit('auth.password_reset.requested', credential.id, credential.id);
    if (process.env.SMTP_HOST && process.env.SMTP_FROM) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      });
      const link = `${requiredEnv('FRONTEND_URL')}/reset-password?token=${encodeURIComponent(rawToken)}`;
      await transporter.sendMail({ from: process.env.SMTP_FROM, to: email, subject: 'Restablece tu contraseña de PayFlex', text: `Usa este enlace en los próximos 30 minutos: ${link}` });
    }
  }
  response.status(202).json({ message: 'If the account exists, recovery instructions will be sent.' });
}));

authRouter.post('/password/reset', asyncRoute(async (request, response) => {
  const { token, password } = z.object({ token: z.string().min(32).max(128), password: z.string().min(12).max(128) }).parse(request.body);
  const resetRepo = database.getRepository(PasswordReset);
  const reset = await resetRepo.findOne({ where: { tokenHash: digest(token), usedAt: IsNull() } });
  if (!reset || reset.expiresAt <= new Date()) {
    response.status(400).json({ error: 'invalid_or_expired_token' });
    return;
  }
  const resetCompleted = await database.transaction(async (manager) => {
    const lockedReset = await manager.getRepository(PasswordReset).createQueryBuilder('reset')
      .setLock('pessimistic_write').where('reset.id = :id', { id: reset.id }).getOne();
    if (!lockedReset || lockedReset.usedAt || lockedReset.expiresAt <= new Date()) return false;
    const credential = await manager.getRepository(AuthCredential).findOne({ where: { id: reset.userId, status: 'active' } });
    if (!credential) return false;
    await manager.getRepository(AuthCredential).update(credential.id, { passwordHash: await bcrypt.hash(password, 12), passwordChangedAt: new Date() });
    await manager.getRepository(AuthSession).update({ userId: credential.id, revokedAt: IsNull() }, { revokedAt: new Date() });
    await manager.getRepository(PasswordReset).update({ userId: credential.id, usedAt: IsNull() }, { usedAt: new Date() });
    return true;
  });
  if (!resetCompleted) {
    response.status(400).json({ error: 'invalid_or_expired_token' });
    return;
  }
  await audit('auth.password_reset.completed', reset.userId, reset.userId);
  response.status(204).end();
}));

authRouter.post('/2fa/setup', authenticate, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;
  const credential = await database.getRepository(AuthCredential).findOneByOrFail({ id: userId });
  const secret = authenticator.generateSecret();
  await database.getRepository(AuthCredential).update(userId, { twoFactorSecret: encryptSecret(secret), twoFactorEnabled: false });
  await audit('auth.2fa.setup_started', userId, userId);
  response.json({ secret, otpauthUrl: authenticator.keyuri(credential.email, 'PayFlex', secret) });
}));

authRouter.post('/2fa/enable', authenticate, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;
  const { otp } = z.object({ otp: z.string().length(6) }).parse(request.body);
  const credential = await database.getRepository(AuthCredential).findOneByOrFail({ id: userId });
  if (!credential.twoFactorSecret || !authenticator.check(otp, decryptSecret(credential.twoFactorSecret))) {
    response.status(400).json({ error: 'invalid_otp' });
    return;
  }
  await database.getRepository(AuthCredential).update(userId, { twoFactorEnabled: true });
  await audit('auth.2fa.enabled', userId, userId);
  response.status(204).end();
}));

authRouter.post('/2fa/disable', authenticate, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;
  const { otp } = z.object({ otp: z.string().length(6) }).parse(request.body);
  const credential = await database.getRepository(AuthCredential).findOneByOrFail({ id: userId });
  if (!credential.twoFactorEnabled || !credential.twoFactorSecret || !authenticator.check(otp, decryptSecret(credential.twoFactorSecret))) {
    response.status(400).json({ error: 'invalid_otp' });
    return;
  }
  await database.getRepository(AuthCredential).update(userId, { twoFactorEnabled: false, twoFactorSecret: null });
  await audit('auth.2fa.disabled', userId, userId);
  response.status(204).end();
}));

authRouter.post('/internal/users/:userId/verify-sensitive', requireInternal, asyncRoute(async (request, response) => {
  const userId = z.string().uuid().parse(request.params.userId);
  const { otp } = z.object({ otp: z.string().length(6).optional() }).parse(request.body);
  const credential = await database.getRepository(AuthCredential).findOne({ where: { id: userId, status: 'active' } });
  if (!credential) {
    response.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (!credential.twoFactorEnabled) {
    response.status(204).end();
    return;
  }
  const identifierHash = digest(userId);
  const attempts = await database.getRepository(LoginAttempt).count({
    where: { identifierHash, successful: false, createdAt: MoreThan(new Date(Date.now() - 15 * 60 * 1000)) },
  });
  if (attempts >= 5) {
    response.status(429).json({ error: 'second_factor_rate_limited' });
    return;
  }
  const valid = Boolean(otp && credential.twoFactorSecret && authenticator.check(otp, decryptSecret(credential.twoFactorSecret)));
  await database.getRepository(LoginAttempt).insert({
    id: crypto.randomUUID(), identifierHash, ipHash: digest(request.ip ?? ''), successful: valid,
  });
  await audit(valid ? 'auth.sensitive_operation.verified' : 'auth.sensitive_operation.failed', userId, userId);
  if (!valid) {
    response.status(401).json({ error: 'second_factor_required' });
    return;
  }
  response.status(204).end();
}));

authRouter.post('/internal/users/:userId/disable', requireInternal, asyncRoute(async (request, response) => {
  const userId = z.string().uuid().parse(request.params.userId);
  await database.getRepository(AuthCredential).update(userId, { status: 'disabled' });
  await database.getRepository(AuthSession).update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
  await audit('auth.user.disabled', null, userId);
  response.status(204).end();
}));

