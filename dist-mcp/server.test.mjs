import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { PayFlexApi } from './api.mjs';
import { MemoryDraftStore } from './drafts.mjs';
import { createPayFlexServer } from './server.mjs';
const accessToken = 'test-user-access-token';
const firstUserId = '93e4278a-fb68-43c0-9570-5efdf1ddc2c6';
const secondUserId = '374dbed8-8304-43c8-ad4e-6b113b966a83';
const recipientWalletId = 'edb93fca-57e2-4e16-a301-5b08bc091d12';
function readText(result) {
    const block = (result.content ?? result.contents)?.[0];
    if (typeof block?.text !== 'string')
        throw new Error('Expected text content');
    return block.text;
}
test('PayFlex MCP registers scoped primitives and protects the transfer confirmation flow', async () => {
    const originalFetch = globalThis.fetch;
    const transferRequests = [];
    globalThis.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.pathname === '/users/me') {
            return new Response(JSON.stringify({ id: firstUserId, firstName: 'Ana', lastName: 'Lopez', email: 'ana@example.test', phone: '+50255551234', status: 'active' }), { headers: { 'content-type': 'application/json' } });
        }
        if (url.pathname === '/accounts/wallets') {
            return new Response(JSON.stringify({ wallets: [{ walletId: '4ae51e2d-47f4-4f4a-b0a2-a29ccbf3111b', currency: 'GTQ', balance: '125.00' }] }), { headers: { 'content-type': 'application/json' } });
        }
        if (url.pathname.startsWith('/notifications/preferences/'))
            return new Response(null, { status: 204 });
        if (url.pathname === '/transactions') {
            const headers = new Headers(init?.headers);
            transferRequests.push({ headers, body: JSON.parse(String(init?.body)) });
            return new Response(JSON.stringify({ transferId: randomUUID(), status: 'confirmed', amount: '25.00', currency: 'GTQ' }), {
                status: 201, headers: { 'content-type': 'application/json' },
            });
        }
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } });
    };
    const drafts = new MemoryDraftStore();
    const api = new PayFlexApi('http://127.0.0.1:8080');
    let approveTransfers = true;
    const approvalMessages = [];
    const handler = createMcpHandler((context) => {
        const principal = context.authInfo?.clientId ?? firstUserId;
        return createPayFlexServer(api, accessToken, principal, drafts);
    });
    async function connectAs(userId) {
        const transport = new StreamableHTTPClientTransport(new URL('http://payflex-mcp.test/mcp'), {
            fetch: (input, init) => handler.fetch(new Request(input, init), {
                authInfo: { token: accessToken, clientId: userId, scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 600 },
            }),
        });
        const client = new Client({ name: 'payflex-mcp-test', version: '1.0.0' }, {
            versionNegotiation: { mode: 'auto' },
            capabilities: { elicitation: { form: {} } },
        });
        client.setRequestHandler('elicitation/create', async (request) => {
            approvalMessages.push(request.params.message);
            return { action: 'accept', content: { approved: approveTransfers } };
        });
        await client.connect(transport);
        return client;
    }
    let firstClient;
    let secondClient;
    try {
        firstClient = await connectAs(firstUserId);
        secondClient = await connectAs(secondUserId);
        const tools = await firstClient.listTools();
        assert.deepEqual(new Set(tools.tools.map((tool) => tool.name)), new Set([
            'get_my_profile', 'list_my_wallets', 'get_my_wallet', 'get_my_transfers',
            'get_my_report_summary', 'list_my_notifications', 'set_my_notification_preference',
            'prepare_transfer', 'confirm_transfer',
        ]));
        const resources = await firstClient.listResources();
        assert.equal(resources.resources.length, 6);
        const prompts = await firstClient.listPrompts();
        assert.deepEqual(prompts.prompts.map((prompt) => prompt.name), ['transfer_review']);
        const profileResource = await firstClient.readResource({ uri: 'payflex://me/profile' });
        assert.equal(JSON.parse(readText(profileResource)).id, firstUserId);
        const preferenceUpdate = await firstClient.callTool({
            name: 'set_my_notification_preference', arguments: { channel: 'in_app', enabled: false },
        });
        assert.equal(preferenceUpdate.isError, undefined);
        const prepared = await firstClient.callTool({
            name: 'prepare_transfer', arguments: { recipientWalletId, amount: '25', currency: 'GTQ' },
        });
        const draft = JSON.parse(readText(prepared));
        assert.equal(draft.amount, '25.00');
        assert.equal(draft.requiresHumanApproval, true);
        const unauthorized = await secondClient.callTool({
            name: 'confirm_transfer', arguments: { draftId: draft.draftId },
        });
        assert.equal(unauthorized.isError, true);
        assert.match(readText(unauthorized), /^NOT_FOUND:/);
        assert.equal(transferRequests.length, 0);
        const declinedDraftResult = await firstClient.callTool({
            name: 'prepare_transfer', arguments: { recipientWalletId, amount: '3.50', currency: 'GTQ' },
        });
        const declinedDraftId = JSON.parse(readText(declinedDraftResult)).draftId;
        approveTransfers = false;
        const declined = await firstClient.callTool({ name: 'confirm_transfer', arguments: { draftId: declinedDraftId } });
        assert.equal(declined.isError, true);
        assert.match(readText(declined), /^FORBIDDEN:/);
        assert.equal(transferRequests.length, 0);
        approveTransfers = true;
        const confirmed = await firstClient.callTool({ name: 'confirm_transfer', arguments: { draftId: draft.draftId, otp: '123456' } });
        assert.equal(confirmed.isError, undefined);
        assert.equal(approvalMessages.length, 2);
        assert.match(approvalMessages[1], /Q 25\.00/);
        assert.match(approvalMessages[1], new RegExp(recipientWalletId));
        assert.equal(transferRequests.length, 1);
        assert.equal(transferRequests[0].headers.get('idempotency-key')?.length, 36);
        assert.equal(transferRequests[0].headers.get('x-2fa-code'), '123456');
        assert.deepEqual(transferRequests[0].body, { recipientWalletId, amount: '25.00', currency: 'GTQ' });
        const repeated = await firstClient.callTool({
            name: 'confirm_transfer', arguments: { draftId: draft.draftId },
        });
        assert.equal(repeated.isError, undefined);
        assert.equal(transferRequests.length, 1);
        const expiredDraftId = randomUUID();
        await drafts.create({
            id: expiredDraftId, ownerId: firstUserId, recipientWalletId, amount: '1.00', currency: 'GTQ',
            idempotencyKey: randomUUID(), expiresAt: Date.now() - 1000, status: 'prepared',
        });
        const expired = await firstClient.callTool({
            name: 'confirm_transfer', arguments: { draftId: expiredDraftId },
        });
        assert.equal(expired.isError, true);
        assert.equal(transferRequests.length, 1);
    }
    finally {
        await firstClient?.close();
        await secondClient?.close();
        await handler.close();
        globalThis.fetch = originalFetch;
    }
});
