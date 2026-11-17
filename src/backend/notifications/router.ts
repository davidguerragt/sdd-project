import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { database } from '../shared/database';
import { NotificationPreference, NotificationRecord, ProcessedEvent } from '../shared/entities';
import { asyncRoute, authenticate, AuthenticatedRequest, requireInternal, requireUser } from '../shared/security';

export const notificationsRouter = Router();
const eventSchema = z.object({
  eventId: z.string().uuid(), transferId: z.string().uuid(), senderUserId: z.string().uuid(),
  recipientUserId: z.string().uuid(), amount: z.string().regex(/^\d{1,16}\.\d{2}$/),
  currency: z.literal('GTQ'), createdAt: z.string().datetime(),
});

notificationsRouter.post('/internal/events', requireInternal, asyncRoute(async (request, response) => {
  const event = eventSchema.parse(request.body);
  await database.transaction(async (manager) => {
    const processedRepo = manager.getRepository(ProcessedEvent);
    const alreadyProcessed = await processedRepo.exist({ where: { consumer: 'notifications', eventId: event.eventId } });
    if (alreadyProcessed) return;
    await processedRepo.insert({ id: crypto.randomUUID(), consumer: 'notifications', eventId: event.eventId });
    const recipients = [event.senderUserId, event.recipientUserId];
    for (const recipientId of recipients) {
      const preference = await manager.getRepository(NotificationPreference).findOne({ where: { userId: recipientId, channel: 'in_app' } });
      if (preference?.enabled === false) continue;
      await manager.getRepository(NotificationRecord).insert({
        id: crypto.randomUUID(), eventId: event.eventId, recipientId, channel: 'in_app',
        payload: {
          type: 'transfer.confirmed', transferId: event.transferId, amount: event.amount,
          currency: event.currency, createdAt: event.createdAt,
        },
        status: 'sent', attempts: 1, sentAt: new Date(),
      });
    }
  });
  response.status(202).json({ accepted: true });
}));

notificationsRouter.get('/', authenticate, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;
  const page = z.coerce.number().int().min(1).default(1).parse(request.query.page);
  const limit = z.coerce.number().int().min(1).max(100).default(20).parse(request.query.limit);
  const [notifications, total] = await database.getRepository(NotificationRecord).findAndCount({
    where: { recipientId: userId }, order: { createdAt: 'DESC' }, skip: (page - 1) * limit, take: limit,
  });
  response.json({ notifications, page, limit, total });
}));

notificationsRouter.get('/preferences', authenticate, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;
  const preferences = await database.getRepository(NotificationPreference).find({ where: { userId } });
  response.json({ availableChannels: ['in_app'], preferences });
}));

notificationsRouter.put('/preferences/:channel', authenticate, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;
  const channel = z.enum(['in_app']).parse(request.params.channel);
  const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
  const repo = database.getRepository(NotificationPreference);
  const preference = await repo.findOne({ where: { userId, channel } });
  if (preference) await repo.update(preference.id, { enabled });
  else await repo.insert({ id: crypto.randomUUID(), userId, channel, enabled });
  response.status(204).end();
}));