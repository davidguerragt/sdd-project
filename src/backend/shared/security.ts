import crypto from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { z } from 'zod';
import { AuthCredential, AuditEvent } from './entities';
import { database } from './database';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  role?: string;
}

export const idSchema = z.string().uuid();
export const emailSchema = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
export const phoneSchema = z.string().trim().regex(/^\+[1-9]\d{7,14}$/);

export function digest(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, requiredEnv('JWT_ACCESS_SECRET'), { expiresIn: '10m', issuer: 'payflex-auth' });
}

export function authenticate(request: AuthenticatedRequest, response: Response, next: NextFunction): void {
  const token = request.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) {
    response.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const payload = jwt.verify(token, requiredEnv('JWT_ACCESS_SECRET'), { issuer: 'payflex-auth' }) as JwtPayload;
    if (typeof payload.sub !== 'string') throw new Error('Invalid subject');
    request.userId = payload.sub;
    next();
  } catch {
    response.status(401).json({ error: 'unauthorized' });
  }
}

export function requireInternal(request: Request, response: Response, next: NextFunction): void {
  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  const provided = request.header('x-internal-service-token') ?? '';
  const expectedBuffer = Buffer.from(expected ?? '');
  const providedBuffer = Buffer.from(provided);
  if (!expected || expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    response.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

export async function assertActiveUser(userId: string): Promise<boolean> {
  const credential = await database.getRepository(AuthCredential).findOne({ where: { id: userId } });
  return credential?.status === 'active';
}

export async function audit(
  action: string,
  actorId: string | null,
  targetId: string | null = null,
  metadata: Record<string, unknown> | null = null,
): Promise<void> {
  await database.getRepository(AuditEvent).insert({
    id: crypto.randomUUID(), action, actorId, targetId,
    ...(metadata ? { metadata: JSON.stringify(metadata) } : {}),
  });
}

export function requireUser(request: AuthenticatedRequest, response: Response): string | undefined {
  if (!request.userId) response.status(401).json({ error: 'unauthorized' });
  return request.userId;
}

export function asyncRoute(
  handler: (request: AuthenticatedRequest, response: Response) => Promise<void>,
) {
  return (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}