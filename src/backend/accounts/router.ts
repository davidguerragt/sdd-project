import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { database } from '../shared/database';
import { Wallet } from '../shared/entities';
import { asyncRoute, authenticate, AuthenticatedRequest, audit, requireInternal, requireUser, requiredEnv } from '../shared/security';

export const accountsRouter = Router();

async function transactionRequest(path: string, method: string, body?: unknown): Promise<Response> {
  const baseUrl = process.env.TRANSACTIONS_SERVICE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  return fetch(`${baseUrl}/transactions/internal${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-internal-service-token': requiredEnv('INTERNAL_SERVICE_TOKEN'),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

accountsRouter.post('/internal/wallets/:walletId/delete', requireInternal, asyncRoute(async (request, response) => {
  await database.getRepository(Wallet).delete(z.string().uuid().parse(request.params.walletId));
  response.status(204).end();
}));

accountsRouter.post('/wallets', authenticate, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const ownerId = requireUser(request, response);
  if (!ownerId) return;
  const idempotencyKey = z.string().min(8).max(128).parse(request.header('idempotency-key'));
  const repo = database.getRepository(Wallet);
  const existing = await repo.findOne({ where: { idempotencyKey } });
  if (existing) {
    if (existing.ownerId === ownerId && existing.idempotencyKey === idempotencyKey) {
      const transactionResponse = await transactionRequest('/accounts', 'POST', {
        walletId: existing.id, ownerId, currency: existing.currency,
      }).catch(() => undefined);
      if (!transactionResponse?.ok) {
        response.status(503).json({ error: 'transactions_service_unavailable' });
        return;
      }
      response.status(200).json({ walletId: existing.id, currency: existing.currency, status: existing.status });
    } else {
      response.status(409).json({ error: 'wallet_already_exists_or_key_conflict' });
    }
    return;
  }

  const wallet = { id: crypto.randomUUID(), ownerId, currency: 'GTQ', status: 'active' as const, idempotencyKey };
  try {
    await repo.insert(wallet);
  } catch (error) {
    const concurrent = await repo.findOne({ where: { idempotencyKey } });
    if (concurrent?.ownerId === ownerId) {
      const transactionResponse = await transactionRequest('/accounts', 'POST', {
        walletId: concurrent.id, ownerId, currency: concurrent.currency,
      }).catch(() => undefined);
      if (!transactionResponse?.ok) {
        response.status(503).json({ error: 'transactions_service_unavailable' });
        return;
      }
      response.status(200).json({ walletId: concurrent.id, currency: concurrent.currency, status: concurrent.status });
      return;
    }
    if (concurrent) {
      response.status(409).json({ error: 'idempotency_key_conflict' });
      return;
    }
    throw error;
  }
  const transactionResponse = await transactionRequest('/accounts', 'POST', {
    walletId: wallet.id, ownerId, currency: wallet.currency,
  }).catch(() => undefined);
  if (!transactionResponse?.ok) {
    response.status(503).json({ error: 'transactions_service_unavailable' });
    return;
  }
  await audit('accounts.wallet.opened', ownerId, wallet.id);
  response.status(201).json({ walletId: wallet.id, currency: wallet.currency, status: wallet.status });
}));

accountsRouter.get('/wallets', authenticate, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const ownerId = requireUser(request, response);
  if (!ownerId) return;
  const wallets = await database.getRepository(Wallet).find({ where: { ownerId }, order: { createdAt: 'ASC' } });
  const results = await Promise.all(wallets.map(async (wallet) => {
    const balanceResponse = await transactionRequest(`/accounts/${wallet.id}`, 'GET').catch(() => undefined);
    if (!balanceResponse?.ok) throw new Error('transactions_service_unavailable');
    const financial = await balanceResponse.json() as { balance: string; status: string; currency: string };
    return { walletId: wallet.id, currency: wallet.currency, status: financial.status, balance: financial.balance };
  }));
  response.json({ wallets: results });
}));

accountsRouter.get('/wallets/:walletId', authenticate, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const ownerId = requireUser(request, response);
  if (!ownerId) return;
  const walletId = z.string().uuid().parse(request.params.walletId);
  const wallet = await database.getRepository(Wallet).findOne({ where: { id: walletId, ownerId } });
  if (!wallet) {
    response.status(404).json({ error: 'wallet_not_found' });
    return;
  }
  const balanceResponse = await transactionRequest(`/accounts/${wallet.id}`, 'GET').catch(() => undefined);
  if (!balanceResponse?.ok) {
    response.status(503).json({ error: 'transactions_service_unavailable' });
    return;
  }
  const financial = await balanceResponse.json() as { balance: string; status: string; currency: string };
  response.json({ walletId: wallet.id, currency: wallet.currency, status: financial.status, balance: financial.balance });
}));

accountsRouter.post('/wallets/:walletId/:action', authenticate, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const ownerId = requireUser(request, response);
  if (!ownerId) return;
  const walletId = z.string().uuid().parse(request.params.walletId);
  const action = z.enum(['suspend', 'reactivate', 'close']).parse(request.params.action);
  const repo = database.getRepository(Wallet);
  const wallet = await repo.findOne({ where: { id: walletId, ownerId } });
  if (!wallet) {
    response.status(404).json({ error: 'wallet_not_found' });
    return;
  }
  const result = await transactionRequest(`/accounts/${walletId}/${action}`, 'POST').catch(() => undefined);
  if (!result?.ok) {
    response.status(result?.status === 409 ? 409 : 503).json({ error: result?.status === 409 ? 'wallet_cannot_be_closed' : 'transactions_service_unavailable' });
    return;
  }
  if (action === 'close') await repo.update(walletId, { status: 'closed' });
  else await repo.update(walletId, { status: action === 'suspend' ? 'suspended' : 'active' });
  await audit(`accounts.wallet.${action}`, ownerId, walletId);
  response.status(204).end();
}));