import { Router } from 'express';
import { z } from 'zod';
import { database } from '../shared/database';
import { UserProfile } from '../shared/entities';
import { asyncRoute, authenticate, AuthenticatedRequest, audit, requireInternal, requireUser, requiredEnv } from '../shared/security';

export const usersRouter = Router();

usersRouter.post('/internal/users', requireInternal, asyncRoute(async (request, response) => {
  const input = z.object({
    id: z.string().uuid(), email: z.string().email().max(254), phone: z.string().min(8).max(20),
    firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80),
  }).parse(request.body);
  await database.getRepository(UserProfile).insert({ ...input, status: 'active' });
  await audit('users.created', null, input.id);
  response.status(201).json({ userId: input.id });
}));

usersRouter.delete('/internal/users/:userId', requireInternal, asyncRoute(async (request, response) => {
  const userId = z.string().uuid().parse(request.params.userId);
  await database.getRepository(UserProfile).delete(userId);
  response.status(204).end();
}));

usersRouter.get('/me', authenticate, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;
  const profile = await database.getRepository(UserProfile).findOne({ where: { id: userId, status: 'active' } });
  if (!profile) {
    response.status(404).json({ error: 'profile_not_found' });
    return;
  }
  response.json({ id: profile.id, firstName: profile.firstName, lastName: profile.lastName, email: profile.email, phone: profile.phone, status: profile.status });
}));

usersRouter.patch('/me', authenticate, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;
  const input = z.object({ firstName: z.string().trim().min(1).max(80).optional(), lastName: z.string().trim().min(1).max(80).optional() }).strict().refine((value) => Object.keys(value).length > 0).parse(request.body);
  await database.getRepository(UserProfile).update({ id: userId, status: 'active' }, input);
  await audit('users.profile.updated', userId, userId, { fields: Object.keys(input) });
  response.status(204).end();
}));

usersRouter.delete('/me', authenticate, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;
  const baseHeaders = { 'x-internal-service-token': requiredEnv('INTERNAL_SERVICE_TOKEN') };
  const authUrl = process.env.AUTH_SERVICE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  const txUrl = process.env.TRANSACTIONS_SERVICE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  const financialResult = await fetch(`${txUrl}/transactions/internal/users/${userId}/disable`, {
    method: 'POST', headers: baseHeaders,
  }).catch(() => undefined);
  if (!financialResult?.ok) {
    response.status(503).json({ error: 'deactivation_service_unavailable' });
    return;
  }
  const authResult = await fetch(`${authUrl}/auth/internal/users/${userId}/disable`, {
    method: 'POST', headers: baseHeaders,
  }).catch(() => undefined);
  if (!authResult?.ok) {
    response.status(503).json({ error: 'deactivation_service_unavailable' });
    return;
  }
  await database.getRepository(UserProfile).update(userId, { status: 'disabled' });
  await audit('users.deactivated', userId, userId);
  response.status(204).end();
}));

usersRouter.post('/internal/users/:userId/audit-access', requireInternal, asyncRoute(async (request, response) => {
  const userId = z.string().uuid().parse(request.params.userId);
  const actorId = z.string().uuid().parse(request.header('x-actor-id'));
  const allowedAdmins = (process.env.ADMIN_USER_IDS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!allowedAdmins.includes(actorId)) {
    response.status(403).json({ error: 'forbidden' });
    return;
  }
  const profile = await database.getRepository(UserProfile).findOne({ where: { id: userId } });
  if (!profile) {
    response.status(404).json({ error: 'profile_not_found' });
    return;
  }
  await audit('users.admin_access', actorId, userId);
  response.json({ id: profile.id, firstName: profile.firstName, lastName: profile.lastName, status: profile.status });
}));