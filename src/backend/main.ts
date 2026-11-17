import 'reflect-metadata';
import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';
import { accountsRouter } from './accounts/router';
import { authRouter } from './auth/router';
import { notificationsRouter } from './notifications/router';
import { reportsRouter } from './reports/router';
import { database } from './shared/database';
import { requiredEnv } from './shared/security';
import { configureGateway } from './gateway/configure';
import { startOutboxPublisher } from './transactions/router';
import { transactionsRouter } from './transactions/router';
import { usersRouter } from './users/router';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
const allowedOrigins = (process.env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
app.use(cors({ origin: (origin, callback) => {
  if (!origin || allowedOrigins.includes(origin)) callback(null, true);
  else callback(new Error('cors_origin_denied'));
} }));
app.use(express.json({ limit: '32kb' }));

app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});
app.get('/ready', (_request, response) => {
  response.status(database.isInitialized ? 200 : 503).json({ status: database.isInitialized ? 'ready' : 'starting' });
});

const routers = {
  auth: ['/auth', authRouter],
  users: ['/users', usersRouter],
  accounts: ['/accounts', accountsRouter],
  transactions: ['/transactions', transactionsRouter],
  notifications: ['/notifications', notificationsRouter],
  reports: ['/reports', reportsRouter],
} as const;
const serviceName = process.env.SERVICE_NAME ?? 'all';

async function start(): Promise<void> {
  if (!['all', 'gateway', ...Object.keys(routers)].includes(serviceName)) throw new Error(`Unknown SERVICE_NAME: ${serviceName}`);
  requiredEnv('JWT_ACCESS_SECRET');
  requiredEnv('INTERNAL_SERVICE_TOKEN');
  if (process.env.JWT_ACCESS_SECRET!.length < 32 || process.env.INTERNAL_SERVICE_TOKEN!.length < 32) {
    throw new Error('JWT_ACCESS_SECRET and INTERNAL_SERVICE_TOKEN must contain at least 32 characters');
  }
  await database.initialize();
  if (serviceName === 'all' || serviceName === 'transactions') startOutboxPublisher();

  if (serviceName === 'gateway') {
    configureGateway(app);
  } else if (serviceName === 'all') {
    for (const [prefix, router] of Object.values(routers)) app.use(prefix, router);
  } else {
    const [prefix, router] = routers[serviceName as keyof typeof routers];
    app.use(prefix, router);
  }

  app.use((_request, response) => response.status(404).json({ error: 'not_found' }));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (response.headersSent) return;
    const validationError = error instanceof z.ZodError;
    const status = validationError ? 400 : error instanceof Error && error.message === 'cors_origin_denied' ? 403 : 500;
    response.status(status).json({ error: validationError ? 'invalid_request' : status === 403 ? 'forbidden' : 'internal_error' });
  });

  const port = Number(process.env.PORT ?? 3000);
  const server = app.listen(port, () => console.log(`PayFlex ${serviceName} service listening on port ${port}`));
  const shutdown = () => server.close(() => { void database.destroy().finally(() => process.exit(0)); });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void start().catch((error: unknown) => {
  console.error('PayFlex startup failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});