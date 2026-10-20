import { ROLES, type Role } from '@dose/contract';
import { screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { auditEntry, detail, fakeApi, renderAdmin, summary, today } from './support';

// What each role sees. The API refuses what a role may not do (permissions.test.ts in @dose/api);
// the admin must not offer it in the first place.

const orderReaders: readonly Role[] = ['owner', 'operations', 'accountant'];

async function openOrderAs(role: Role) {
  const api = fakeApi(role, { order: vi.fn(() => Promise.resolve(detail())) });
  renderAdmin('/orders/D10001', api);
  await screen.findByRole('heading', { name: 'Order D10001' });
  return api;
}

test.each(['owner', 'operations'] as const)('%s sees Confirm and Cancel on a pending order', async (role) => {
  await openOrderAs(role);
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();
});

test('an accountant sees the order but neither Confirm nor Cancel', async () => {
  await openOrderAs('accountant');
  expect(screen.getByText('Test Customer')).toBeVisible();
  expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
});

test.each(ROLES)('the Audit link is shown to the owner only (%s)', async (role) => {
  const api = fakeApi(role, { today: vi.fn(() => Promise.resolve(today([summary()]))) });
  renderAdmin('/', api);
  await screen.findByText(`Test ${role} (${role})`);
  const link = screen.queryByRole('link', { name: 'Audit log' });
  if (role === 'owner') expect(link).toBeVisible();
  else expect(link).toBeNull();
});

test.each(orderReaders)('%s has Today and Orders in the navigation', async (role) => {
  const api = fakeApi(role, { today: vi.fn(() => Promise.resolve(today([]))) });
  renderAdmin('/', api);
  expect(await screen.findByRole('link', { name: 'Today' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Orders' })).toBeVisible();
});

test('marketing has no order pages in this milestone, and the admin does not ask the API for any', async () => {
  const api = fakeApi('marketing');
  renderAdmin('/', api);
  expect(await screen.findByText('Your role has no admin pages yet.')).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Today' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Orders' })).toBeNull();
  expect(api.today).not.toHaveBeenCalled();
});

test('someone who types the audit address without being the owner is told so, and nothing is requested', async () => {
  const api = fakeApi('operations', { audit: vi.fn(() => Promise.resolve({ events: [auditEntry()], nextCursor: null })) });
  renderAdmin('/audit', api);
  expect(await screen.findByText('Only the owner can see the audit log.')).toBeVisible();
  expect(api.audit).not.toHaveBeenCalled();
});

test('someone who is not signed in is told to sign in', async () => {
  const { AdminApiError } = await import('../src/api');
  const api = fakeApi('owner', { me: vi.fn(() => Promise.reject(new AdminApiError('unauthenticated', 401))) });
  renderAdmin('/', api);
  expect(await screen.findByRole('alert')).toHaveTextContent('You are not signed in');
});
