import crypto from 'node:crypto';
import { Router } from 'express';
import { IsNull, In } from 'typeorm';
import { z } from 'zod';
import { database } from '../shared/database';
import { AuditEvent, FinancialAccount, LedgerEntry, OutboxEvent, TestWalletFunding, Transfer } from '../shared/entities';
import { asyncRoute, authenticate, AuthenticatedRequest, audit, requireInternal, requireUser, requiredEnv } from '../shared/security';
import { decimalToCents, formatCents, parseAmountToCents } from '../shared/money';

export const transactionsRouter = Router();

const transferEventSchema = z.object({
  eventId: z.string().uuid(), transferId: z.string().uuid(), senderId: z.string().uuid(),
  recipientId: z.string().uuid(), senderUserId: z.string().uuid(), recipientUserId: z.string().uuid(),
  amount: z.string(), currency: z.literal('GTQ'), createdAt: z.string().datetime(),
});

function testFundingEnabled(): boolean {
  return ['development', 'test'].includes(process.env.NODE_ENV ?? '') && process.env.ENABLE_TEST_FUNDING === 'true';
}

transactionsRouter.post('/internal/accounts', requireInternal, asyncRoute(async (request, response) => {
  const input = z.object({ walletId: z.string().uuid(), ownerId: z.string().uuid(), currency: z.literal('GTQ') }).parse(request.body);
  await database.getRepository(FinancialAccount).createQueryBuilder().insert().into(FinancialAccount)
    .values({ ...input, id: input.walletId, balance: '0.00', status: 'active' }).orIgnore().execute();
  response.status(201).end();
}));

transactionsRouter.get('/internal/accounts/:walletId', requireInternal, asyncRoute(async (request, response) => {
  const account = await database.getRepository(FinancialAccount).findOneBy({ id: z.string().uuid().parse(request.params.walletId) });
  if (!account) {
    response.status(404).json({ error: 'wallet_not_found' });
    return;
  }
  response.json({ balance: account.balance, status: account.status, currency: account.currency });
}));

transactionsRouter.post('/internal/accounts/:walletId/:action', requireInternal, asyncRoute(async (request, response) => {
  const walletId = z.string().uuid().parse(request.params.walletId);
  const action = z.enum(['suspend', 'reactivate', 'close']).parse(request.params.action);
  const result = await database.transaction(async (manager) => {
    const account = await manager.getRepository(FinancialAccount).createQueryBuilder('account')
      .setLock('pessimistic_write').where('account.id = :walletId', { walletId }).getOne();
    if (!account) return 'not_found';
    if (action === 'close') {
      const cents = decimalToCents(account.balance);
      const pending = await manager.getRepository(Transfer).count({ where: [
        { senderId: walletId, status: 'pending' }, { recipientId: walletId, status: 'pending' },
      ] });
      if (cents !== 0n || pending > 0) return 'conflict';
      account.status = 'closed';
    } else if (account.status === 'closed' || account.status === 'disabled') {
      return 'conflict';
    } else {
      account.status = action === 'suspend' ? 'suspended' : 'active';
    }
    await manager.getRepository(FinancialAccount).save(account);
    return 'ok';
  });
  if (result === 'not_found') response.status(404).json({ error: 'wallet_not_found' });
  else if (result === 'conflict') response.status(409).json({ error: 'wallet_cannot_change_state' });
  else response.status(204).end();
}));

transactionsRouter.post('/internal/users/:userId/disable', requireInternal, asyncRoute(async (request, response) => {
  const userId = z.string().uuid().parse(request.params.userId);
  await database.getRepository(FinancialAccount).update({ ownerId: userId }, { status: 'disabled' });
  response.status(204).end();
}));

transactionsRouter.post('/test/fund', (request, response, next) => {
  if (!testFundingEnabled()) {
    response.status(404).json({ error: 'not_found' });
    return;
  }
  next();
}, authenticate, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const actorId = requireUser(request, response);
  if (!actorId) return;
  const input = z.object({
    walletId: z.string().uuid(),
    amount: z.string(),
    currency: z.literal('GTQ').default('GTQ'),
  }).strict().parse(request.body);
  const idempotencyKey = request.header('idempotency-key');
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    response.status(400).json({ error: 'idempotency_key_required' });
    return;
  }
  let amountCents: bigint;
  try {
    amountCents = parseAmountToCents(input.amount);
  } catch {
    response.status(400).json({ error: 'invalid_amount' });
    return;
  }
  const amount = formatCents(amountCents);
  const requestHash = crypto.createHash('sha256')
    .update(`${actorId}|${input.walletId}|${amountCents}|${input.currency}`)
    .digest('hex');
  const fundingRepo = database.getRepository(TestWalletFunding);

  const respondWithPrior = async () => {
    const prior = await fundingRepo.findOne({ where: { idempotencyKey } });
    if (!prior) return false;
    if (prior.actorId !== actorId || prior.requestHash !== requestHash) {
      response.status(409).json({ error: 'idempotency_key_conflict' });
      return true;
    }
    response.status(200).json({
      fundingId: prior.id, walletId: prior.walletId, amount: prior.amount,
      currency: prior.currency, balance: prior.balanceAfter, simulated: true, createdAt: prior.createdAt,
    });
    return true;
  };

  if (await respondWithPrior()) return;

  const authUrl = process.env.AUTH_SERVICE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  const secondFactorResult = await fetch(`${authUrl}/auth/internal/users/${actorId}/verify-sensitive`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-service-token': requiredEnv('INTERNAL_SERVICE_TOKEN'),
    },
    body: JSON.stringify({ otp: request.header('x-2fa-code') }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
  if (!secondFactorResult?.ok) {
    const status = secondFactorResult?.status === 401 || secondFactorResult?.status === 429 ? secondFactorResult.status : 503;
    response.status(status).json({ error: status === 503 ? 'authentication_service_unavailable' : 'second_factor_required' });
    return;
  }

  const now = new Date();
  try {
    const funding = await database.transaction(async (manager) => {
      const account = await manager.getRepository(FinancialAccount).createQueryBuilder('account')
        .setLock('pessimistic_write').where('account.id = :walletId', { walletId: input.walletId }).getOne();
      if (!account || account.ownerId !== actorId) throw new Error('wallet_not_found');
      if (account.status !== 'active' || account.currency !== input.currency) throw new Error('wallet_inactive');

      const balanceCents = decimalToCents(account.balance);
      if (balanceCents + amountCents > 999999999999999999n) throw new Error('balance_limit_exceeded');
      account.balance = formatCents(balanceCents + amountCents);
      await manager.getRepository(FinancialAccount).save(account);

      const record = {
        id: crypto.randomUUID(), actorId, walletId: account.id, amount, balanceAfter: account.balance,
        currency: input.currency, idempotencyKey, requestHash, createdAt: now,
      };
      await manager.getRepository(TestWalletFunding).insert(record);
      await manager.getRepository(AuditEvent).insert({
        id: crypto.randomUUID(), actorId, action: 'transactions.test_funding.created', targetId: account.id,
        metadata: JSON.stringify({ fundingId: record.id, amount, currency: input.currency, simulated: true }),
        createdAt: now,
      });
      return record;
    });
    response.status(201).json({
      fundingId: funding.id, walletId: funding.walletId, amount: funding.amount,
      currency: funding.currency, balance: funding.balanceAfter, simulated: true, createdAt: funding.createdAt,
    });
  } catch (error) {
    if (await respondWithPrior()) return;
    const message = error instanceof Error ? error.message : '';
    const status = message === 'wallet_not_found' ? 404 : ['wallet_inactive', 'balance_limit_exceeded'].includes(message) ? 409 : 500;
    response.status(status).json({ error: status === 500 ? 'test_funding_failed' : message });
  }
}));

transactionsRouter.post('/', authenticate, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const senderId = requireUser(request, response);
  if (!senderId) return;
  const input = z.object({
    senderWalletId: z.string().uuid(), recipientWalletId: z.string().uuid(), amount: z.string(),
    currency: z.literal('GTQ').default('GTQ'),
  }).strict().parse(request.body);
  const idempotencyKey = request.header('idempotency-key');
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    response.status(400).json({ error: 'idempotency_key_required' });
    return;
  }
  let amountCents: bigint;
  try {
    amountCents = parseAmountToCents(input.amount);
  } catch {
    response.status(400).json({ error: 'invalid_amount' });
    return;
  }
  const senderAccount = await database.getRepository(FinancialAccount).findOne({ where: { id: input.senderWalletId, ownerId: senderId } });
  if (!senderAccount) {
    response.status(404).json({ error: 'wallet_not_found' });
    return;
  }
  const senderWalletId = input.senderWalletId;
  const recipientId = input.recipientWalletId;
  if (recipientId === senderWalletId) {
    response.status(400).json({ error: 'same_wallet' });
    return;
  }
  const requestHash = crypto.createHash('sha256').update(`${senderWalletId}|${recipientId}|${amountCents}|GTQ`).digest('hex');
  const transferRepo = database.getRepository(Transfer);
  const prior = await transferRepo.findOne({ where: { idempotencyKey } });
  if (prior) {
    if (prior.requestHash !== requestHash) {
      response.status(409).json({ error: 'idempotency_key_conflict' });
      return;
    }
    response.status(200).json({ transferId: prior.id, status: prior.status, amount: prior.amount, currency: prior.currency, createdAt: prior.createdAt });
    return;
  }

  const authUrl = process.env.AUTH_SERVICE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  const secondFactorResult = await fetch(`${authUrl}/auth/internal/users/${senderId}/verify-sensitive`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-service-token': requiredEnv('INTERNAL_SERVICE_TOKEN'),
    },
    body: JSON.stringify({ otp: request.header('x-2fa-code') }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
  if (!secondFactorResult?.ok) {
    const status = secondFactorResult?.status === 401 || secondFactorResult?.status === 429 ? secondFactorResult.status : 503;
    response.status(status).json({ error: status === 503 ? 'authentication_service_unavailable' : 'second_factor_required' });
    return;
  }

  try {
    const transfer = await database.transaction(async (manager) => {
      const accountIds = [senderWalletId, recipientId].sort();
      const accounts = await manager.getRepository(FinancialAccount).createQueryBuilder('account')
        .setLock('pessimistic_write')
        .where('account.id IN (:...accountIds)', { accountIds })
        .orderBy('account.id', 'ASC')
        .getMany();
      if (accounts.length !== 2) throw new Error('wallet_not_found');
      const sender = accounts.find((account) => account.id === senderWalletId);
      const recipient = accounts.find((account) => account.id === recipientId);
      if (!sender || !recipient || sender.ownerId !== request.userId) throw new Error('wallet_not_owned');
      if (sender.status !== 'active' || recipient.status !== 'active' || sender.currency !== 'GTQ' || recipient.currency !== 'GTQ') {
        throw new Error('wallet_inactive');
      }
      const senderBalance = decimalToCents(sender.balance);
      if (senderBalance < amountCents) throw new Error('insufficient_funds');
      const recipientBalance = decimalToCents(recipient.balance);
      if (recipientBalance + amountCents > 999999999999999999n) throw new Error('balance_limit_exceeded');
      sender.balance = formatCents(senderBalance - amountCents);
      recipient.balance = formatCents(recipientBalance + amountCents);
      await manager.getRepository(FinancialAccount).save([sender, recipient]);

      const transferId = crypto.randomUUID();
      const savedTransfer = await manager.getRepository(Transfer).save({
        id: transferId, senderId: senderWalletId, recipientId, amount: formatCents(amountCents), currency: 'GTQ',
        status: 'confirmed', idempotencyKey, requestHash,
      });
      await manager.getRepository(LedgerEntry).insert([
        { id: crypto.randomUUID(), transferId, walletId: senderWalletId, direction: 'debit', amount: savedTransfer.amount, currency: 'GTQ' },
        { id: crypto.randomUUID(), transferId, walletId: recipientId, direction: 'credit', amount: savedTransfer.amount, currency: 'GTQ' },
      ]);
      const eventId = crypto.randomUUID();
      await manager.getRepository(OutboxEvent).insert({
        id: eventId, eventType: 'transfer.confirmed', aggregateId: transferId,
        payload: {
          eventId, transferId, senderId: senderWalletId, recipientId,
          senderUserId: sender.ownerId, recipientUserId: recipient.ownerId, amount: savedTransfer.amount,
          currency: 'GTQ', createdAt: savedTransfer.createdAt.toISOString(),
        },
        attempts: 0,
      });
      return savedTransfer;
    });
    await audit('transactions.transfer.confirmed', senderId, transfer.id, { amount: transfer.amount, currency: 'GTQ' });
    response.status(201).json({ transferId: transfer.id, status: transfer.status, amount: transfer.amount, currency: transfer.currency, createdAt: transfer.createdAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const duplicate = await transferRepo.findOne({ where: { idempotencyKey } }).catch(() => null);
    if (duplicate) {
      if (duplicate.requestHash === requestHash) {
        response.status(200).json({ transferId: duplicate.id, status: duplicate.status, amount: duplicate.amount, currency: duplicate.currency, createdAt: duplicate.createdAt });
      } else {
        response.status(409).json({ error: 'idempotency_key_conflict' });
      }
      return;
    }
    const status = message === 'wallet_not_found' ? 404 : message === 'wallet_not_owned' ? 403 : ['insufficient_funds', 'wallet_inactive', 'balance_limit_exceeded'].includes(message) ? 409 : 500;
    response.status(status).json({ error: status === 500 ? 'transfer_failed' : message });
  }
}));

transactionsRouter.get('/history', authenticate, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;
  const page = z.coerce.number().int().min(1).default(1).parse(request.query.page);
  const limit = z.coerce.number().int().min(1).max(100).default(20).parse(request.query.limit);
  const accountIds = await database.getRepository(FinancialAccount).find({ where: { ownerId: userId }, select: { id: true } });
  const ids = accountIds.map((account) => account.id);
  if (ids.length === 0) {
    response.json({ transfers: [], page, limit, total: 0 });
    return;
  }
  const [transfers, total] = await database.getRepository(Transfer).findAndCount({
    where: [{ senderId: In(ids) }, { recipientId: In(ids) }],
    order: { createdAt: 'DESC' }, skip: (page - 1) * limit, take: limit,
  });
  response.json({ transfers, page, limit, total });
}));

export async function publishOutboxBatch(): Promise<void> {
  const repo = database.getRepository(OutboxEvent);
  const events = await repo.createQueryBuilder('event')
    .where('event.publishedAt IS NULL')
    .andWhere('(event.nextAttemptAt IS NULL OR event.nextAttemptAt <= :now)', { now: new Date() })
    .orderBy('event.createdAt', 'ASC').take(50).getMany();
  for (const event of events) {
    let delivered = true;
    for (const serviceName of ['NOTIFICATIONS_SERVICE_URL', 'REPORTS_SERVICE_URL']) {
      const baseUrl = process.env[serviceName] ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
      try {
        const result = await fetch(`${baseUrl}/${serviceName === 'NOTIFICATIONS_SERVICE_URL' ? 'notifications' : 'reports'}/internal/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-internal-service-token': requiredEnv('INTERNAL_SERVICE_TOKEN') },
          body: JSON.stringify(event.payload),
          signal: AbortSignal.timeout(5000),
        });
        if (!result.ok) delivered = false;
      } catch {
        delivered = false;
      }
    }
    const attempts = event.attempts + 1;
    if (delivered) {
      await repo.update(event.id, { publishedAt: new Date(), attempts });
    } else {
      const delayMs = Math.min(5 * 60 * 1000, 1000 * (2 ** Math.min(attempts, 8)));
      await repo.update(event.id, { attempts, nextAttemptAt: new Date(Date.now() + delayMs) });
    }
  }
}

export function startOutboxPublisher(): NodeJS.Timeout {
  const timer = setInterval(() => { void publishOutboxBatch().catch(() => undefined); }, 2000);
  timer.unref();
  return timer;
}