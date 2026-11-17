export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: 'active' | 'disabled';
}

export class PayFlexApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

export class PayFlexApi {
  private readonly baseUrl: URL;

  constructor(baseUrl: string) {
    this.baseUrl = new URL(baseUrl);
    if (!['http:', 'https:'].includes(this.baseUrl.protocol) || this.baseUrl.username || this.baseUrl.password) {
      throw new Error('PAYFLEX_API_BASE_URL must be an HTTP(S) URL without embedded credentials');
    }
    const localHttp = ['localhost', '127.0.0.1'].includes(this.baseUrl.hostname)
      || (this.baseUrl.hostname === 'gateway' && process.env.NODE_ENV !== 'production');
    if (this.baseUrl.protocol === 'http:' && !localHttp) {
      throw new Error('PAYFLEX_API_BASE_URL must use HTTPS outside local development');
    }
    this.baseUrl.pathname = `${this.baseUrl.pathname.replace(/\/$/, '')}/`;
  }

  async request<T>(path: string, accessToken: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
    const url = new URL(path.replace(/^\//, ''), this.baseUrl);
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${accessToken}`,
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...options.headers,
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new PayFlexApiError(503, 'upstream_unavailable');
    }

    if (!response.ok) {
      let code = 'upstream_error';
      try {
        const body = await response.json() as { error?: unknown };
        if (typeof body.error === 'string') code = body.error;
      } catch {
        code = 'upstream_error';
      }
      throw new PayFlexApiError(response.status, code);
    }
    if (response.status === 204) return undefined as T;

    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > 1_000_000) throw new PayFlexApiError(502, 'response_too_large');
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new PayFlexApiError(502, 'invalid_upstream_response');
    }
  }

  getProfile(token: string): Promise<UserProfile> {
    return this.request('/users/me', token);
  }
}

export function decodeTokenExpiry(token: string): number | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof claims.exp === 'number' && Number.isFinite(claims.exp) ? claims.exp : undefined;
  } catch {
    return undefined;
  }
}

export function publicError(error: unknown): { code: string; message: string } {
  if (!(error instanceof PayFlexApiError)) return { code: 'INTERNAL_ERROR', message: 'No se pudo completar la solicitud.' };
  if (error.code === 'confirmation_declined') return { code: 'FORBIDDEN', message: 'La persona rechazó la transferencia; no se movieron fondos.' };
  if (error.code === 'confirmation_not_checked') return { code: 'VALIDATION_ERROR', message: 'Para continuar, marca explícitamente la aprobación de la transferencia.' };
  if (error.code === 'draft_confirmation_in_progress') return { code: 'RATE_LIMITED', message: 'La confirmación ya está en curso.' };
  if (error.status === 401) return { code: 'UNAUTHENTICATED', message: 'La sesión venció o no es válida.' };
  if (error.status === 403) return { code: 'FORBIDDEN', message: 'No tienes permiso para esta operación.' };
  if (error.status === 404) return { code: 'NOT_FOUND', message: 'No se encontró el recurso solicitado.' };
  if (error.status === 429) return { code: 'RATE_LIMITED', message: 'Se alcanzó el límite de solicitudes; inténtalo más tarde.' };
  const codes: Record<string, [string, string]> = {
    insufficient_funds: ['INSUFFICIENT_FUNDS', 'No hay saldo suficiente para completar la transferencia.'],
    wallet_inactive: ['WALLET_INACTIVE', 'Una de las billeteras no está activa.'],
    second_factor_required: ['SECOND_FACTOR_REQUIRED', 'Se requiere un código TOTP válido.'],
    idempotency_key_conflict: ['IDEMPOTENCY_CONFLICT', 'La clave de idempotencia ya se usó con otros datos.'],
    invalid_amount: ['VALIDATION_ERROR', 'El importe no es válido en GTQ.'],
    same_wallet: ['VALIDATION_ERROR', 'La billetera emisora y receptora deben ser distintas.'],
    transactions_service_unavailable: ['UPSTREAM_UNAVAILABLE', 'El servicio de transacciones no está disponible.'],
    authentication_service_unavailable: ['UPSTREAM_UNAVAILABLE', 'El servicio de autenticación no está disponible.'],
  };
  const mapped = codes[error.code];
  if (mapped) return { code: mapped[0], message: mapped[1] };
  if (error.status >= 500) return { code: 'UPSTREAM_UNAVAILABLE', message: 'PayFlex no está disponible temporalmente.' };
  return { code: 'VALIDATION_ERROR', message: 'PayFlex rechazó los datos de la solicitud.' };
}