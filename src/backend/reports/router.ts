import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { database } from '../shared/database';
import { ProcessedEvent, TransferProjection } from '../shared/entities';
import { asyncRoute, authenticate, AuthenticatedRequest, audit, requireInternal, requireUser } from '../shared/security';

export const reportsRouter = Router();
const eventSchema = z.object({
  eventId: z.string().uuid(), transferId: z.string().uuid(), senderUserId: z.string().uuid(),
  recipientUserId: z.string().uuid(), amount: z.string().regex(/^\d{1,16}\.\d{2}$/),
  currency: z.literal('GTQ'), createdAt: z.string().datetime(),
});

reportsRouter.post('/internal/events', requireInternal, asyncRoute(async (request, response) => {
  const event = eventSchema.parse(request.body);
  await database.transaction(async (manager) => {
    const processedRepo = manager.getRepository(ProcessedEvent);
    const alreadyProcessed = await processedRepo.exist({ where: { consumer: 'reports', eventId: event.eventId } });
    if (alreadyProcessed) return;
    await processedRepo.insert({ id: crypto.randomUUID(), consumer: 'reports', eventId: event.eventId });
    const createdAt = new Date(event.createdAt);
    await manager.getRepository(TransferProjection).insert([
      {
        id: crypto.randomUUID(), userId: event.senderUserId, transferId: event.transferId,
        counterpartyId: event.recipientUserId, direction: 'sent', amount: event.amount,
        currency: event.currency, status: 'confirmed', createdAt,
      },
      {
        id: crypto.randomUUID(), userId: event.recipientUserId, transferId: event.transferId,
        counterpartyId: event.senderUserId, direction: 'received', amount: event.amount,
        currency: event.currency, status: 'confirmed', createdAt,
      },
    ]);
  });
  response.status(202).json({ accepted: true });
}));

reportsRouter.get('/transfers', authenticate, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;
  const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    direction: z.enum(['sent', 'received']).optional(),
    status: z.literal('confirmed').optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  });
  const filters = querySchema.parse(request.query);
  const from = filters.from ? new Date(filters.from) : undefined;
  const to = filters.to ? new Date(filters.to) : undefined;
  if (Boolean(from) !== Boolean(to)) {
    response.status(400).json({ error: 'both_date_bounds_required' });
    return;
  }
  if (from && to && (to < from || to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000)) {
    response.status(400).json({ error: 'invalid_date_range' });
    return;
  }
  const query = database.getRepository(TransferProjection).createQueryBuilder('projection')
    .where('projection.userId = :userId', { userId });
  if (filters.direction) query.andWhere('projection.direction = :direction', { direction: filters.direction });
  if (from) query.andWhere('projection.createdAt >= :from', { from });
  if (to) query.andWhere('projection.createdAt <= :to', { to });
  const [transfers, total] = await query.orderBy('projection.createdAt', 'DESC')
    .skip((filters.page - 1) * filters.limit).take(filters.limit).getManyAndCount();
  const latest = await database.getRepository(TransferProjection).createQueryBuilder('projection')
    .select('MAX(projection.createdAt)', 'asOf').where('projection.userId = :userId', { userId })
    .getRawOne<{ asOf: Date | null }>();
  response.json({ transfers, page: filters.page, limit: filters.limit, total, dataAsOf: latest?.asOf ?? null });
}));

reportsRouter.get('/summary', authenticate, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;
  const filters = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() }).parse(request.query);
  const from = filters.from ? new Date(filters.from) : undefined;
  const to = filters.to ? new Date(filters.to) : undefined;
  if (Boolean(from) !== Boolean(to)) {
    response.status(400).json({ error: 'both_date_bounds_required' });
    return;
  }
  if (from && to && (to < from || to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000)) {
    response.status(400).json({ error: 'invalid_date_range' });
    return;
  }
  const query = database.getRepository(TransferProjection).createQueryBuilder('projection')
    .select("COALESCE(SUM(CASE WHEN projection.direction = 'received' THEN projection.amount ELSE 0 END), 0)", 'incoming')
    .addSelect("COALESCE(SUM(CASE WHEN projection.direction = 'sent' THEN projection.amount ELSE 0 END), 0)", 'outgoing')
    .where('projection.userId = :userId', { userId })
    .andWhere('projection.status = :status', { status: 'confirmed' });
  if (from) query.andWhere('projection.createdAt >= :from', { from });
  if (to) query.andWhere('projection.createdAt <= :to', { to });
  const totals = await query.getRawOne<{ incoming: string; outgoing: string }>();
  const latest = await database.getRepository(TransferProjection).createQueryBuilder('projection')
    .select('MAX(projection.createdAt)', 'asOf').where('projection.userId = :userId', { userId }).getRawOne<{ asOf: Date | null }>();
  response.json({ currency: 'GTQ', incoming: totals?.incoming ?? '0.00', outgoing: totals?.outgoing ?? '0.00', dataAsOf: latest?.asOf ?? null });
}));

reportsRouter.get('/admin/summary', authenticate, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;
  const allowedAdmins = (process.env.ADMIN_USER_IDS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!allowedAdmins.includes(userId)) {
    response.status(403).json({ error: 'forbidden' });
    return;
  }
  await audit('reports.admin_summary.read', userId);
  const summary = await database.getRepository(TransferProjection).createQueryBuilder('projection')
    .select('COUNT(DISTINCT projection.transferId)', 'confirmedTransfers')
    .addSelect('COALESCE(SUM(CASE WHEN projection.direction = \'sent\' THEN projection.amount ELSE 0 END), 0)', 'grossVolume')
    .where('projection.status = :status', { status: 'confirmed' }).getRawOne();
  response.json({ ...summary, currency: 'GTQ', dataAsOf: new Date().toISOString() });
}));