import type { AuditEntry, AuditPage, OrderDetail, OrderSummary, Role, Staff, TodayView } from '@dose/contract';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import type { AdminApi } from '../src/api';
import { AdminRoutes } from '../src/AdminApp';

export function staffWithRole(role: Role): Staff {
  return { id: `staff-${role}`, email: `${role}@example.test`, name: `Test ${role}`, role };
}

export function summary(overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    number: 'D10001',
    createdAt: '2026-10-20T10:00:00.000Z',
    customerName: 'Test Customer',
    customerPhone: '+201012345678',
    governorate: 'cairo',
    total: 123_400,
    orderState: 'pending',
    paymentState: 'awaiting_collection',
    fulfilmentState: 'unfulfilled',
    version: 1,
    ...overrides,
  };
}

export function detail(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    ...summary(),
    lang: 'en',
    direction: 'd0-baseline',
    channel: 'web',
    paymentMethod: 'cod',
    address: { governorate: 'cairo', area: 'Nasr City', street: '10 Test Street', building: 'Building 4, flat 12' },
    lines: [
      { sku: 'PARADISE-50ML', nameAr: 'باراديس', nameEn: 'Paradise', unitPrice: 58_200, quantity: 2, lineDiscount: 0, lineTotal: 116_400 },
    ],
    subtotal: 116_400,
    discountTotal: 0,
    deliveryFee: 7_000,
    timeline: [{ at: '2026-10-20T10:00:00.000Z', actorType: 'customer', actorLabel: '+201012345678', action: 'order.placed' }],
    ...overrides,
  };
}

export function today(orders: OrderSummary[], oldestWaitingMinutes: number | null = orders.length > 0 ? 12 : null): TodayView {
  return { toConfirm: { count: orders.length, oldestWaitingMinutes, orders } };
}

export function auditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: '10',
    at: '2026-10-20T10:00:00.000Z',
    actorType: 'customer',
    actorId: '+201012345678',
    actorLabel: '+201012345678',
    action: 'order.placed',
    entity: 'order',
    entityId: 'D10001',
    entityVersion: 1,
    reason: null,
    data: {},
    ...overrides,
  };
}

/** An API whose every call but `me` fails the test until it is given an answer. */
export function fakeApi(role: Role, overrides: Partial<AdminApi> = {}): AdminApi {
  const unexpected = (name: string) => () => Promise.reject(new Error(`unexpected call to api.${name}`));
  return {
    me: vi.fn(() => Promise.resolve(staffWithRole(role))),
    today: vi.fn(unexpected('today')),
    orders: vi.fn(unexpected('orders')),
    order: vi.fn(unexpected('order')),
    confirm: vi.fn(unexpected('confirm')),
    cancel: vi.fn(unexpected('cancel')),
    audit: vi.fn((): Promise<AuditPage> => Promise.reject(new Error('unexpected call to api.audit'))),
    ...overrides,
  };
}

/** The admin at `path` (relative to `/admin`), as the app mounts it. */
export function renderAdmin(path: string, api: AdminApi) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminRoutes api={api} />
    </MemoryRouter>,
  );
}
