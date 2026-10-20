import type {
  AuditPage,
  CancelOrderInput,
  ConfirmOrderInput,
  OrderActionResult,
  OrderDetail,
  OrderState,
  OrderSummary,
  Staff,
  TodayView,
} from '@dose/contract';

/** The admin API as the screens use it. Tests give the screens a fake of this. */
export type AdminApi = {
  me: () => Promise<Staff>;
  today: () => Promise<TodayView>;
  orders: (filter: { q?: string; state?: OrderState }) => Promise<OrderSummary[]>;
  /** Resolves `null` when there is no such order. */
  order: (number: string) => Promise<OrderDetail | null>;
  confirm: (number: string, input: ConfirmOrderInput) => Promise<OrderActionResult>;
  cancel: (number: string, input: CancelOrderInput) => Promise<OrderActionResult>;
  audit: (cursor?: string) => Promise<AuditPage>;
};

/** An answer the screens cannot use: not signed in (401), not allowed (403), a server fault, or not JSON. */
export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new AdminApiError(`The server answered ${String(response.status)} with something other than JSON`, response.status);
  }
}

function isActionResult(body: unknown): body is OrderActionResult {
  return typeof body === 'object' && body !== null && 'ok' in body && typeof body.ok === 'boolean';
}

/** The statuses on which confirm and cancel answer with an `OrderActionResult`. */
const ACTION_ANSWERS: readonly number[] = [200, 404, 409, 422];

/**
 * The admin API over `fetch`. Requests go to the same origin, which carries the staff member's
 * Cloudflare Access cookie. Every body the screens read is trusted to be what the API promises
 * (the types come from `@dose/contract`); an answer that is not JSON, or a status the API does
 * not use for that route, is an `AdminApiError`.
 */
export function createAdminApi(send: (input: string, init?: RequestInit) => Promise<Response> = (input, init) => fetch(input, init)): AdminApi {
  const read = async <T>(path: string): Promise<T> => {
    const response = await send(path);
    const body = await readJson(response);
    if (!response.ok) throw new AdminApiError(`GET ${path} answered ${String(response.status)}`, response.status);
    return body as T;
  };

  const act = async (number: string, action: 'confirm' | 'cancel', input: ConfirmOrderInput | CancelOrderInput): Promise<OrderActionResult> => {
    const path = `/api/admin/orders/${encodeURIComponent(number)}/${action}`;
    const response = await send(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = await readJson(response);
    if (!ACTION_ANSWERS.includes(response.status) || !isActionResult(body)) {
      throw new AdminApiError(`POST ${path} answered ${String(response.status)}`, response.status);
    }
    return body;
  };

  return {
    me: () => read<Staff>('/api/admin/me'),
    today: () => read<TodayView>('/api/admin/today'),
    orders: (filter) => {
      const query = new URLSearchParams();
      if (filter.q !== undefined) query.set('q', filter.q);
      if (filter.state !== undefined) query.set('state', filter.state);
      const text = query.toString();
      return read<OrderSummary[]>(`/api/admin/orders${text === '' ? '' : `?${text}`}`);
    },
    order: async (number) => {
      const path = `/api/admin/orders/${encodeURIComponent(number)}`;
      const response = await send(path);
      if (response.status === 404) return null;
      const body = await readJson(response);
      if (!response.ok) throw new AdminApiError(`GET ${path} answered ${String(response.status)}`, response.status);
      return body as OrderDetail;
    },
    confirm: (number, input) => act(number, 'confirm', input),
    cancel: (number, input) => act(number, 'cancel', input),
    audit: (cursor) => read<AuditPage>(`/api/admin/audit${cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`}`),
  };
}
