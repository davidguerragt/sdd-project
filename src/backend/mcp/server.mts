import crypto from 'node:crypto';
import {
  acceptedContent, inputRequired, inputResponse, McpServer,
  type McpServerFactory,
} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { PayFlexApi, PayFlexApiError, publicError } from './api.mjs';
import type { DraftStore, TransferDraft } from './drafts.mjs';

const MAX_PAGE_SIZE = 100;
const DRAFT_LIFETIME_MS = 5 * 60 * 1000;

function parseAmount(value: string): string {
  if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(value)) throw new PayFlexApiError(400, 'invalid_amount');
  const [whole, fraction = ''] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents <= 0n) throw new PayFlexApiError(400, 'invalid_amount');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

function toToolResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function toToolError(error: unknown) {
  const mapped = publicError(error);
  return { content: [{ type: 'text' as const, text: `${mapped.code}: ${mapped.message}` }], isError: true };
}

function resourceError(error: unknown): Error {
  return new Error(publicError(error).message);
}

function registerJsonResource(
  server: McpServer,
  name: string,
  uri: string,
  description: string,
  read: () => Promise<unknown>,
): void {
  server.registerResource(name, uri, { mimeType: 'application/json', description }, async (resourceUri) => {
    try {
      const data = await read();
      return { contents: [{ uri: resourceUri.href, mimeType: 'application/json', text: JSON.stringify(data) }] };
    } catch (error) {
      throw resourceError(error);
    }
  });
}

export function createPayFlexServer(api: PayFlexApi, accessToken: string, ownerId: string, drafts: DraftStore): McpServer {
  const server = new McpServer({ name: 'payflex-mcp', version: '1.0.0' });
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const localWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  const myProfile = () => api.request('/users/me', accessToken);
  const myWallets = () => api.request('/accounts/wallets', accessToken);
  const mySummary = () => api.request('/reports/summary', accessToken);
  const myNotifications = () => api.request('/notifications?limit=100&page=1', accessToken);
  const myNotificationPreferences = () => api.request('/notifications/preferences', accessToken);

  registerJsonResource(server, 'my-profile', 'payflex://me/profile', 'Perfil del usuario autenticado.', myProfile);
  registerJsonResource(server, 'my-wallets', 'payflex://me/wallets', 'Billeteras propias con saldo autoritativo GTQ.', myWallets);
  registerJsonResource(server, 'my-transfers', 'payflex://me/transfers', 'Historial propio paginado; es una proyección derivada.', () =>
    api.request('/reports/transfers?page=1&limit=100', accessToken));
  registerJsonResource(server, 'my-report-summary', 'payflex://me/report-summary', 'Resumen propio de operaciones confirmadas con dataAsOf.', mySummary);
  registerJsonResource(server, 'my-notifications', 'payflex://me/notifications', 'Notificaciones in-app del usuario autenticado.', myNotifications);
  registerJsonResource(server, 'my-notification-preferences', 'payflex://me/notification-preferences', 'Preferencias propias de notificacion.', myNotificationPreferences);

  server.registerTool('get_my_profile', {
    description: 'Consulta el perfil propio de la sesion autenticada.', inputSchema: z.object({}), annotations: readOnly,
  }, async () => {
    try { return toToolResult(await myProfile()); } catch (error) { return toToolError(error); }
  });

  server.registerTool('list_my_wallets', {
    description: 'Lista las billeteras propias y sus saldos autoritativos en GTQ.', inputSchema: z.object({}), annotations: readOnly,
  }, async () => {
    try { return toToolResult(await myWallets()); } catch (error) { return toToolError(error); }
  });

  server.registerTool('get_my_wallet', {
    description: 'Consulta una billetera por ID; el backend verifica que pertenezca a la sesion.',
    inputSchema: z.object({ walletId: z.string().uuid() }), annotations: readOnly,
  }, async ({ walletId }) => {
    try { return toToolResult(await api.request(`/accounts/wallets/${encodeURIComponent(walletId)}`, accessToken)); }
    catch (error) { return toToolError(error); }
  });

  server.registerTool('get_my_transfers', {
    description: 'Consulta historial propio con filtros, fechas ISO 8601 y paginas de hasta 100 resultados.',
    inputSchema: z.object({
      from: z.iso.datetime().optional(),
      to: z.iso.datetime().optional(),
      direction: z.enum(['sent', 'received']).optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
    }).strict(),
    annotations: readOnly,
  }, async ({ from, to, direction, page, limit }) => {
    if (Boolean(from) !== Boolean(to) || (from && to && new Date(to).getTime() - new Date(from).getTime() > 366 * 24 * 60 * 60 * 1000)) {
      return toToolError(new PayFlexApiError(400, 'invalid_date_range'));
    }
    const query = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    if (direction) query.set('direction', direction);
    try { return toToolResult(await api.request(`/reports/transfers?${query}`, accessToken)); }
    catch (error) { return toToolError(error); }
  });

  server.registerTool('get_my_report_summary', {
    description: 'Obtiene el resumen propio de entradas y salidas confirmadas en GTQ y su fecha dataAsOf.',
    inputSchema: z.object({ from: z.iso.datetime().optional(), to: z.iso.datetime().optional() }).strict(),
    annotations: readOnly,
  }, async ({ from, to }) => {
    if (Boolean(from) !== Boolean(to) || (from && to && new Date(to).getTime() - new Date(from).getTime() > 366 * 24 * 60 * 60 * 1000)) {
      return toToolError(new PayFlexApiError(400, 'invalid_date_range'));
    }
    const query = new URLSearchParams();
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    try { return toToolResult(await api.request(`/reports/summary${query.size ? `?${query}` : ''}`, accessToken)); }
    catch (error) { return toToolError(error); }
  });

  server.registerTool('list_my_notifications', {
    description: 'Lista hasta 100 notificaciones in-app propias.',
    inputSchema: z.object({ page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(20) }).strict(),
    annotations: readOnly,
  }, async ({ page, limit }) => {
    try { return toToolResult(await api.request(`/notifications?page=${page}&limit=${limit}`, accessToken)); }
    catch (error) { return toToolError(error); }
  });

  server.registerTool('set_my_notification_preference', {
    description: 'Actualiza la preferencia propia del canal in_app.',
    inputSchema: z.object({ channel: z.literal('in_app'), enabled: z.boolean() }).strict(),
    annotations: localWrite,
  }, async ({ channel, enabled }) => {
    try {
      await api.request(`/notifications/preferences/${channel}`, accessToken, { method: 'PUT', body: { enabled } });
      return toToolResult({ updated: true, channel, enabled });
    } catch (error) { return toToolError(error); }
  });

  server.registerTool('prepare_transfer', {
    description: 'Prepara un borrador P2P GTQ de 5 minutos. No reserva fondos ni mueve dinero; presenta el resumen al usuario y pide aprobacion explicita antes de confirmar.',
    inputSchema: z.object({ recipientWalletId: z.string().uuid(), amount: z.string(), currency: z.literal('GTQ').default('GTQ') }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ recipientWalletId, amount, currency }) => {
    try {
      const normalizedAmount = parseAmount(amount);
      const draft: TransferDraft = {
        id: crypto.randomUUID(), ownerId, recipientWalletId, amount: normalizedAmount, currency,
        idempotencyKey: crypto.randomUUID(), expiresAt: Date.now() + DRAFT_LIFETIME_MS, status: 'prepared',
      };
      await drafts.create(draft);
      return toToolResult({
        draftId: draft.id, recipientWalletId, amount: normalizedAmount, currency,
        expiresAt: new Date(draft.expiresAt).toISOString(), requiresHumanApproval: true,
        warning: 'Este borrador no reserva fondos. Muestra estos datos y solicita aprobacion explicita antes de ejecutar confirm_transfer.',
      });
    } catch (error) { return toToolError(error); }
  });

  server.registerTool('confirm_transfer', {
    description: 'Solicita aprobacion explicita a la persona para el borrador inalterado y, si aprueba, confirma la transferencia. Si 2FA esta activo, pasa otp. Reintenta exclusivamente el mismo borrador.',
    inputSchema: z.object({ draftId: z.string().uuid(), otp: z.string().regex(/^\d{6}$/).optional() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ draftId, otp }, context) => {
    const approvalSchema = z.object({ approved: z.boolean().meta({ title: 'Apruebo esta transferencia' }) });
    const draftBeforeApproval = await drafts.get(draftId);
    if (!draftBeforeApproval || draftBeforeApproval.expiresAt <= Date.now()) {
      return toToolError(new PayFlexApiError(404, 'draft_expired_or_not_found'));
    }
    if (draftBeforeApproval.ownerId !== ownerId) return toToolError(new PayFlexApiError(404, 'draft_expired_or_not_found'));
    if (draftBeforeApproval.status === 'confirmed' && draftBeforeApproval.result) return toToolResult(draftBeforeApproval.result);

    const approval = acceptedContent(context.mcpReq.inputResponses, 'human_approval', approvalSchema);
    if (approval?.approved === false) return toToolError(new PayFlexApiError(403, 'confirmation_declined'));
    if (approval === undefined) {
      const previousResponse = inputResponse(context.mcpReq.inputResponses, 'human_approval');
      if (previousResponse.kind === 'elicit' && previousResponse.action !== 'accept') {
        return toToolError(new PayFlexApiError(403, 'confirmation_declined'));
      }
      if (previousResponse.kind === 'elicit' && previousResponse.action === 'accept') {
        return toToolError(new PayFlexApiError(403, 'confirmation_not_checked'));
      }
      return inputRequired({
        inputRequests: {
          human_approval: inputRequired.elicit({
            message: `¿Apruebas enviar Q ${draftBeforeApproval.amount} a la billetera ${draftBeforeApproval.recipientWalletId}? Esta acción moverá fondos de forma permanente.`,
            requestedSchema: approvalSchema,
          }),
        },
      });
    }

    const lockToken = await drafts.acquire(draftId);
    if (!lockToken) return toToolError(new PayFlexApiError(409, 'draft_confirmation_in_progress'));
    try {
      const draft = await drafts.get(draftId);
      if (!draft || draft.expiresAt <= Date.now()) return toToolError(new PayFlexApiError(404, 'draft_expired_or_not_found'));
      if (draft.ownerId !== ownerId) return toToolError(new PayFlexApiError(404, 'draft_expired_or_not_found'));
      if (draft.status === 'confirmed' && draft.result) return toToolResult(draft.result);

      const result = await api.request<Record<string, unknown>>('/transactions', accessToken, {
        method: 'POST',
        body: { recipientWalletId: draft.recipientWalletId, amount: draft.amount, currency: draft.currency },
        headers: {
          'idempotency-key': draft.idempotencyKey,
          ...(otp ? { 'x-2fa-code': otp } : {}),
        },
      });
      const confirmed: TransferDraft = { ...draft, status: 'confirmed', result };
      await drafts.save(confirmed);
      return toToolResult(result);
    } catch (error) {
      return toToolError(error);
    } finally {
      await drafts.release(draftId, lockToken).catch(() => undefined);
    }
  });

  server.registerPrompt('transfer_review', {
    description: 'Presenta los datos de un borrador P2P para que la persona lo revise. No ejecuta la transferencia.',
    argsSchema: z.object({ draftId: z.string().uuid() }),
  }, async ({ draftId }) => {
    const draft = await drafts.get(draftId);
    if (!draft || draft.ownerId !== ownerId || draft.expiresAt <= Date.now()) {
      return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'El borrador no existe, vencio o no pertenece a esta sesion.' } }] };
    }
    return {
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `Revisa esta transferencia PayFlex: enviar Q ${draft.amount} (${draft.currency}) a la billetera ${draft.recipientWalletId}. Este borrador vence ${new Date(draft.expiresAt).toISOString()}. No confirmes hasta recibir aprobacion explicita de la persona.` } }],
    };
  });

  return server;
}

export function createServerFactory(api: PayFlexApi, drafts: DraftStore): McpServerFactory {
  return (context) => {
    const accessToken = context.authInfo?.token;
    const ownerId = context.authInfo?.clientId;
    if (!accessToken || !ownerId) throw new Error('Authenticated PayFlex user context required');
    return createPayFlexServer(api, accessToken, ownerId, drafts);
  };
}