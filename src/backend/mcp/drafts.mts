import crypto from 'node:crypto';

interface RedisDraftClient {
  get(key: string): Promise<string | null>;
  sendCommand(args: string[]): Promise<unknown>;
}

export interface TransferDraft {
  id: string;
  ownerId: string;
  recipientWalletId: string;
  amount: string;
  currency: 'GTQ';
  idempotencyKey: string;
  expiresAt: number;
  status: 'prepared' | 'confirmed';
  result?: Record<string, unknown>;
}

export interface DraftStore {
  create(draft: TransferDraft): Promise<void>;
  get(id: string): Promise<TransferDraft | null>;
  save(draft: TransferDraft): Promise<void>;
  acquire(id: string): Promise<string | null>;
  release(id: string, lockToken: string): Promise<void>;
}

export class MemoryDraftStore implements DraftStore {
  private readonly drafts = new Map<string, TransferDraft>();
  private readonly locks = new Set<string>();

  async create(draft: TransferDraft): Promise<void> {
    this.drafts.set(draft.id, draft);
  }

  async get(id: string): Promise<TransferDraft | null> {
    const draft = this.drafts.get(id);
    if (!draft || draft.expiresAt <= Date.now()) {
      this.drafts.delete(id);
      return null;
    }
    return draft;
  }

  async save(draft: TransferDraft): Promise<void> {
    this.drafts.set(draft.id, draft);
  }

  async acquire(id: string): Promise<string | null> {
    if (this.locks.has(id)) return null;
    const lockToken = crypto.randomUUID();
    this.locks.add(id);
    return lockToken;
  }

  async release(id: string, _lockToken: string): Promise<void> {
    this.locks.delete(id);
  }
}

export class RedisDraftStore implements DraftStore {
  constructor(private readonly client: RedisDraftClient) {}

  async create(draft: TransferDraft): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil((draft.expiresAt - Date.now()) / 1000));
    const result = await this.client.sendCommand([
      'SET', this.draftKey(draft.id), JSON.stringify(draft), 'EX', String(ttlSeconds), 'NX',
    ]);
    if (String(result) !== 'OK') throw new Error('DRAFT_ID_CONFLICT');
  }

  async get(id: string): Promise<TransferDraft | null> {
    const result = await this.client.get(this.draftKey(id));
    if (!result) return null;
    const draft = JSON.parse(result) as TransferDraft;
    return draft.expiresAt > Date.now() ? draft : null;
  }

  async save(draft: TransferDraft): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil((draft.expiresAt - Date.now()) / 1000));
    await this.client.sendCommand(['SET', this.draftKey(draft.id), JSON.stringify(draft), 'EX', String(ttlSeconds)]);
  }

  async acquire(id: string): Promise<string | null> {
    const lockToken = crypto.randomUUID();
    const result = await this.client.sendCommand([
      'SET', this.lockKey(id), lockToken, 'EX', '30', 'NX',
    ]);
    return String(result) === 'OK' ? lockToken : null;
  }

  async release(id: string, lockToken: string): Promise<void> {
    await this.client.sendCommand([
      'EVAL',
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
      '1', this.lockKey(id), lockToken,
    ]);
  }

  private draftKey(id: string): string {
    return `payflex:mcp:draft:${id}`;
  }

  private lockKey(id: string): string {
    return `payflex:mcp:draft-lock:${id}`;
  }
}