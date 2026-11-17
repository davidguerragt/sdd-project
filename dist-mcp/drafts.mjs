import crypto from 'node:crypto';
export class MemoryDraftStore {
    drafts = new Map();
    locks = new Set();
    async create(draft) {
        this.drafts.set(draft.id, draft);
    }
    async get(id) {
        const draft = this.drafts.get(id);
        if (!draft || draft.expiresAt <= Date.now()) {
            this.drafts.delete(id);
            return null;
        }
        return draft;
    }
    async save(draft) {
        this.drafts.set(draft.id, draft);
    }
    async acquire(id) {
        if (this.locks.has(id))
            return null;
        const lockToken = crypto.randomUUID();
        this.locks.add(id);
        return lockToken;
    }
    async release(id, _lockToken) {
        this.locks.delete(id);
    }
}
export class RedisDraftStore {
    client;
    constructor(client) {
        this.client = client;
    }
    async create(draft) {
        const ttlSeconds = Math.max(1, Math.ceil((draft.expiresAt - Date.now()) / 1000));
        const result = await this.client.sendCommand([
            'SET', this.draftKey(draft.id), JSON.stringify(draft), 'EX', String(ttlSeconds), 'NX',
        ]);
        if (String(result) !== 'OK')
            throw new Error('DRAFT_ID_CONFLICT');
    }
    async get(id) {
        const result = await this.client.get(this.draftKey(id));
        if (!result)
            return null;
        const draft = JSON.parse(result);
        return draft.expiresAt > Date.now() ? draft : null;
    }
    async save(draft) {
        const ttlSeconds = Math.max(1, Math.ceil((draft.expiresAt - Date.now()) / 1000));
        await this.client.sendCommand(['SET', this.draftKey(draft.id), JSON.stringify(draft), 'EX', String(ttlSeconds)]);
    }
    async acquire(id) {
        const lockToken = crypto.randomUUID();
        const result = await this.client.sendCommand([
            'SET', this.lockKey(id), lockToken, 'EX', '30', 'NX',
        ]);
        return String(result) === 'OK' ? lockToken : null;
    }
    async release(id, lockToken) {
        await this.client.sendCommand([
            'EVAL',
            "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
            '1', this.lockKey(id), lockToken,
        ]);
    }
    draftKey(id) {
        return `payflex:mcp:draft:${id}`;
    }
    lockKey(id) {
        return `payflex:mcp:draft-lock:${id}`;
    }
}
