import type { AuditPage } from '@dose/contract';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { auditEntry, fakeApi, renderAdmin } from './support';

const FIRST: AuditPage = {
  events: [
    auditEntry({ id: '30', action: 'order.confirmed', actorType: 'staff', actorId: 'operations@example.test', actorLabel: 'Local Operations', entityVersion: 2, data: { method: 'whatsapp', note: null } }),
    auditEntry({ id: '20', action: 'order.placed' }),
  ],
  nextCursor: '20',
};
const SECOND: AuditPage = {
  events: [
    auditEntry({ id: '10', action: 'order.cancelled', entityId: 'D10000', actorType: 'system', actorId: 'expiry', actorLabel: 'expiry', reason: 'confirmation_window_expired' }),
  ],
  nextCursor: null,
};

test('the owner sees the newest events first, who did what to which order', async () => {
  const audit = vi.fn(() => Promise.resolve(FIRST));
  renderAdmin('/audit', fakeApi('owner', { audit }));

  const table = await screen.findByRole('table', { name: 'Audit log' });
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent('Order confirmed · WhatsApp');
  expect(rows[0]).toHaveTextContent('Local Operations');
  expect(within(rows[0] as HTMLElement).getByRole('link', { name: 'D10001' })).toHaveAttribute('href', '/orders/D10001');
  expect(rows[1]).toHaveTextContent('Order placed');
  expect(rows[1]).toHaveTextContent('Customer +201012345678');
  expect(audit).toHaveBeenCalledWith(undefined);
});

test('"Load older events" asks for the next page by cursor and appends it', async () => {
  const audit = vi.fn((cursor?: string) => Promise.resolve(cursor === undefined ? FIRST : SECOND));
  renderAdmin('/audit', fakeApi('owner', { audit }));
  await screen.findByRole('table', { name: 'Audit log' });
  const user = userEvent.setup();

  await user.click(screen.getByRole('button', { name: 'Load older events' }));
  expect(audit).toHaveBeenLastCalledWith('20');
  const rows = within(screen.getByRole('table', { name: 'Audit log' })).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(3);
  expect(rows[2]).toHaveTextContent('Order cancelled · Confirmation window expired');
  expect(rows[2]).toHaveTextContent('System (expiry)');
  // That was the last page.
  expect(screen.queryByRole('button', { name: 'Load older events' })).toBeNull();
});

test('an event nobody has a word for is shown by its name, not hidden', async () => {
  const audit = vi.fn(() => Promise.resolve({ events: [auditEntry({ action: 'stock.adjusted', entity: 'variant', entityId: 'PARADISE-50ML' })], nextCursor: null }));
  renderAdmin('/audit', fakeApi('owner', { audit }));
  const table = await screen.findByRole('table', { name: 'Audit log' });
  expect(within(table).getByText('stock.adjusted')).toBeVisible();
  expect(within(table).getByText('variant PARADISE-50ML')).toBeVisible();
});

test('a failed page shows an error and can be retried', async () => {
  const audit = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(FIRST);
  renderAdmin('/audit', fakeApi('owner', { audit }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the audit log.');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('table', { name: 'Audit log' })).toBeVisible();
});
