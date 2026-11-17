import 'dotenv/config';
import crypto from 'node:crypto';
import helmet from 'helmet';
import { createClient } from 'redis';
import { createMcpExpressApp, requireBearerAuth } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, OAuthError, OAuthErrorCode, } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { PayFlexApi, PayFlexApiError, decodeTokenExpiry } from './api.mjs';
import { MemoryDraftStore, RedisDraftStore } from './drafts.mjs';
import { createPayFlexServer } from './server.mjs';
const api = new PayFlexApi(process.env.PAYFLEX_API_BASE_URL ?? 'http://127.0.0.1:8080');
const memoryDrafts = new MemoryDraftStore();
const transportMode = process.argv.includes('--http') ? 'http' : process.env.MCP_TRANSPORT ?? 'stdio';
function invalidToken() {
    return new OAuthError(OAuthErrorCode.InvalidToken, 'PayFlex access token is invalid or expired');
}
function createBearerVerifier() {
    return {
        async verifyAccessToken(token) {
            const expiresAt = decodeTokenExpiry(token);
            if (!expiresAt || expiresAt <= Math.floor(Date.now() / 1000))
                throw invalidToken();
            let profile;
            try {
                profile = await api.getProfile(token);
            }
            catch (error) {
                if (error instanceof PayFlexApiError && error.status === 401)
                    throw invalidToken();
                throw error;
            }
            if (profile.status !== 'active')
                throw invalidToken();
            return { token, clientId: profile.id, scopes: [], expiresAt };
        },
    };
}
function csvEnvironment(name) {
    return (process.env[name] ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
}
async function startStdio() {
    const token = process.env.PAYFLEX_ACCESS_TOKEN;
    if (!token)
        throw new Error('PAYFLEX_ACCESS_TOKEN is required for stdio; configure it in the local MCP client environment');
    const profile = await api.getProfile(token);
    if (profile.status !== 'active')
        throw new Error('The PayFlex user session is not active');
    serveStdio(() => createPayFlexServer(api, token, profile.id, memoryDrafts), {
        onerror: () => process.stderr.write('PayFlex MCP stdio protocol error\n'),
    });
    process.stderr.write('PayFlex MCP server ready on stdio\n');
}
async function incrementRateLimit(redis, key) {
    const result = await redis.sendCommand([
        'EVAL',
        'local count = redis.call("INCR", KEYS[1]); if count == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]); end; return count',
        '1', key, '60',
    ]);
    return Number(result);
}
function rateLimitByIp(redis) {
    return async (request, response, next) => {
        try {
            const ipHash = crypto.createHash('sha256').update(request.ip ?? 'unknown').digest('hex');
            const window = Math.floor(Date.now() / 60_000);
            if (await incrementRateLimit(redis, `payflex:mcp:rate:ip:${ipHash}:${window}`) > 120) {
                response.status(429).json({ error: 'rate_limit_exceeded' });
                return;
            }
            next();
        }
        catch {
            response.status(503).json({ error: 'rate_limit_unavailable' });
        }
    };
}
function rateLimitByUser(redis) {
    return async (request, response, next) => {
        try {
            const principal = request.auth?.clientId;
            if (!principal) {
                response.status(401).json({ error: 'unauthorized' });
                return;
            }
            const principalHash = crypto.createHash('sha256').update(principal).digest('hex');
            const window = Math.floor(Date.now() / 60_000);
            if (await incrementRateLimit(redis, `payflex:mcp:rate:user:${principalHash}:${window}`) > 120) {
                response.status(429).json({ error: 'rate_limit_exceeded' });
                return;
            }
            next();
        }
        catch {
            response.status(503).json({ error: 'rate_limit_unavailable' });
        }
    };
}
async function startHttp() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl)
        throw new Error('REDIS_URL is required for Streamable HTTP draft storage');
    const redis = createClient({ url: redisUrl });
    redis.on('error', () => process.stderr.write('PayFlex MCP Redis connection error\n'));
    const host = process.env.MCP_HOST ?? '127.0.0.1';
    const allowedHosts = csvEnvironment('MCP_ALLOWED_HOSTS');
    const allowedOrigins = csvEnvironment('MCP_ALLOWED_ORIGINS');
    const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
    if (!isLoopback && allowedHosts.length === 0)
        throw new Error('MCP_ALLOWED_HOSTS is required when MCP_HOST is not loopback');
    if (!isLoopback && allowedOrigins.length === 0)
        throw new Error('MCP_ALLOWED_ORIGINS is required when MCP_HOST is not loopback');
    if (process.env.NODE_ENV === 'production') {
        const publicUrl = process.env.MCP_PUBLIC_URL;
        if (!publicUrl || new URL(publicUrl).protocol !== 'https:') {
            throw new Error('MCP_PUBLIC_URL must be HTTPS in production; terminate TLS at a trusted proxy');
        }
    }
    await redis.connect();
    const drafts = new RedisDraftStore(redis);
    const app = createMcpExpressApp({
        host,
        ...(allowedHosts.length ? { allowedHosts } : {}),
        ...(allowedOrigins.length ? { allowedOrigins } : {}),
        jsonLimit: '32kb',
    });
    app.disable('x-powered-by');
    app.use(helmet());
    app.get('/health', (_request, response) => response.status(200).json({ status: 'ok' }));
    app.get('/ready', (_request, response) => response.status(redis.isReady ? 200 : 503).json({ status: redis.isReady ? 'ready' : 'starting' }));
    const verifier = createBearerVerifier();
    const authenticate = requireBearerAuth({ verifier });
    const handler = createMcpHandler((context) => {
        const token = context.authInfo?.token;
        const ownerId = context.authInfo?.clientId;
        if (!token || !ownerId)
            throw new Error('Authenticated PayFlex user context required');
        return createPayFlexServer(api, token, ownerId, drafts);
    });
    const nodeHandler = toNodeHandler(handler);
    const ipRateLimit = rateLimitByIp(redis);
    const userRateLimit = rateLimitByUser(redis);
    app.use('/mcp', ipRateLimit);
    app.all('/mcp', authenticate, userRateLimit, (request, response) => {
        void nodeHandler(request, response, request.body);
    });
    app.use((_error, _request, response, _next) => {
        if (!response.headersSent)
            response.status(500).json({ error: 'internal_error' });
    });
    const port = Number(process.env.MCP_PORT ?? process.env.PORT ?? 4000);
    const listener = app.listen(port, host, () => process.stderr.write(`PayFlex MCP Streamable HTTP listening on ${host}:${port}/mcp\n`));
    let stopping = false;
    const shutdown = () => {
        if (stopping)
            return;
        stopping = true;
        listener.close(() => {
            void handler.close().finally(() => redis.quit().finally(() => process.exit(0)));
        });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
async function start() {
    if (transportMode === 'stdio')
        return startStdio();
    if (transportMode === 'http')
        return startHttp();
    throw new Error('MCP_TRANSPORT must be stdio or http');
}
void start().catch((error) => {
    process.stderr.write(`PayFlex MCP startup failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
});
