import crypto from 'node:crypto';
import { Express, Request, Response, NextFunction } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { database } from '../shared/database';

const proxyTargets = [
  ['/auth', 'AUTH_SERVICE_URL'],
  ['/users', 'USERS_SERVICE_URL'],
  ['/accounts', 'ACCOUNTS_SERVICE_URL'],
  ['/transactions', 'TRANSACTIONS_SERVICE_URL'],
  ['/notifications', 'NOTIFICATIONS_SERVICE_URL'],
  ['/reports', 'REPORTS_SERVICE_URL'],
] as const;

async function sharedRateLimit(request: Request, response: Response, next: NextFunction): Promise<void> {
  const ipHash = crypto.createHash('sha256').update(request.ip ?? '').digest('hex');
  const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  try {
    await database.query(
      'INSERT INTO gateway_rate_limits (ip_hash, window_start, request_count) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE request_count = request_count + 1',
      [ipHash, windowStart],
    );
    const [bucket] = await database.query(
      'SELECT request_count AS requestCount FROM gateway_rate_limits WHERE ip_hash = ? AND window_start = ?',
      [ipHash, windowStart],
    ) as Array<{ requestCount: number }>;
    if (Number(bucket?.requestCount ?? 0) > 300) {
      response.setHeader('retry-after', String(60 - Math.floor((Date.now() % 60_000) / 1000)));
      response.status(429).json({ error: 'rate_limit_exceeded' });
      return;
    }
    next();
  } catch {
    response.status(503).json({ error: 'rate_limit_unavailable' });
  }
}

export function configureGateway(app: Express): void {
  app.use(sharedRateLimit);
  for (const [prefix, environmentVariable] of proxyTargets) {
    const target = process.env[environmentVariable];
    if (!target) throw new Error(`${environmentVariable} must be configured for gateway mode`);
    app.use(prefix, createProxyMiddleware({
      target,
      changeOrigin: true,
      pathRewrite: (path) => `${prefix}${path === '/' ? '' : path}`,
      on: {
        error: (_error, _request, response) => {
          const proxyResponse = response as Response;
          if (!proxyResponse.headersSent) proxyResponse.status(502).json({ error: 'upstream_unavailable' });
        },
      },
    }));
  }
}