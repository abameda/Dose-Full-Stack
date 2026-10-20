import type { OrderActionResult } from '@dose/contract';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { AdminApi } from '../src/api';
import { detail, fakeApi, renderAdmin } from './support';

// The order page as operations sees it: confirm and cancel, the dialogs' rules, and what a
// stale version looks like.

const OK: OrderActionResult = { ok: true, version: 2 };

async function openOrder(overrides: Parameters<typeof fakeApi>[1] = {}) {
  const api = fakeApi('operations', { order: vi.fn(() => Promise.resolve(detail())), ...overrides });
  renderAdmin('/orders/D10001', api);
  await screen.findByRole('heading', { name: 'Order D10001' });
  return { api, user: userEvent.setup() };
}

test('Confirm is disabled until a method is chosen', async () => {
  const { user } = await openOrder();
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  const dialog = screen.getByRole('dialog', { name: 'Confirm order D10001' });
  const submit = within(dialog).getByRole('button', { name: 'Confirm order' });
  expect(submit).toBeDisabled();

  await user.click(within(dialog).getByRole('radio', { name: 'WhatsApp' }));
  expect(submit).toBeEnabled();
});

test('confirming sends the version the page showed, the method and the note, then reloads the order', async () => {
  const confirm = vi.fn<AdminApi['confirm']>(() => Promise.resolve(OK));
  const order = vi
    .fn()
    .mockResolvedValueOnce(detail())
    .mockResolvedValueOnce(
      detail({
        orderState: 'confirmed',
        version: 2,
        timeline: [
          { at: '2026-10-20T10:00:00.000Z', actorType: 'customer', actorLabel: '+201012345678', action: 'order.placed' },
          { at: '2026-10-20T10:05:00.000Z', actorType: 'staff', actorLabel: 'Test operations', action: 'order.confirmed', method: 'phone' },
        ],
      }),
    );
  const { user } = await openOrder({ confirm, order });

  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('radio', { name: 'Phone call' }));
  await user.type(within(dialog).getByLabelText('Note (optional)'), 'Spoke to her');
  await user.click(within(dialog).getByRole('button', { name: 'Confirm order' }));

  expect(confirm).toHaveBeenCalledExactlyOnceWith('D10001', { expectedVersion: 1, method: 'phone', note: 'Spoke to her' });
  expect(await screen.findByText('Confirmed by Test operations · Phone call')).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  expect(order).toHaveBeenCalledTimes(2);
});

test('the WhatsApp link opens the customer number with the message in the order language (Arabic)', async () => {
  const { user } = await openOrder({ order: vi.fn(() => Promise.resolve(detail({ lang: 'ar', customerName: 'منى' }))) });
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  const link = within(screen.getByRole('dialog')).getByRole('link', { name: /WhatsApp/ });

  const href = new URL(link.getAttribute('href') ?? '');
  expect(href.origin + href.pathname).toBe('https://wa.me/201012345678');
  const text = href.searchParams.get('text') ?? '';
  expect(text).toContain('D10001');
  expect(text).toContain('منى');
  expect(text).toMatch(/\p{Script=Arabic}/u);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link.getAttribute('rel')).toContain('noopener');
});

test('the WhatsApp message is in English for an English order, with the total in Western digits', async () => {
  const { user } = await openOrder();
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  const link = within(screen.getByRole('dialog')).getByRole('link', { name: /WhatsApp/ });
  const text = new URL(link.getAttribute('href') ?? '').searchParams.get('text') ?? '';
  expect(text).toContain('Test Customer');
  expect(text).toContain('EGP 1,234');
  expect(text).not.toMatch(/\p{Script=Arabic}/u);
});

test('Cancel needs a reason, and the reason "Other" needs a note', async () => {
  const cancel = vi.fn<AdminApi['cancel']>(() => Promise.resolve(OK));
  const { user } = await openOrder({ cancel });
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  const dialog = screen.getByRole('dialog', { name: 'Cancel order D10001' });
  const submit = within(dialog).getByRole('button', { name: 'Cancel order' });
  expect(submit).toBeDisabled();

  // All seven reasons are offered.
  const reasons = within(dialog).getByLabelText('Reason');
  expect(within(reasons).getAllByRole('option').filter((o) => o.getAttribute('value') !== '')).toHaveLength(7);

  await user.selectOptions(reasons, 'other');
  expect(within(dialog).getByLabelText('Note (required)')).toBeVisible();
  await user.click(submit);
  expect(cancel).not.toHaveBeenCalled();
  expect(within(dialog).getByText('Add a note: it is required when the reason is Other.')).toBeVisible();

  await user.type(within(dialog).getByLabelText('Note (required)'), 'Customer asked on Instagram');
  await user.click(submit);
  expect(cancel).toHaveBeenCalledExactlyOnceWith('D10001', { expectedVersion: 1, reason: 'other', note: 'Customer asked on Instagram' });
});

test('a note of spaces does not satisfy "Other"', async () => {
  const cancel = vi.fn<AdminApi['cancel']>(() => Promise.resolve(OK));
  const { user } = await openOrder({ cancel });
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  const dialog = screen.getByRole('dialog');
  await user.selectOptions(within(dialog).getByLabelText('Reason'), 'other');
  await user.type(within(dialog).getByLabelText('Note (required)'), '   ');
  await user.click(within(dialog).getByRole('button', { name: 'Cancel order' }));
  expect(cancel).not.toHaveBeenCalled();
});

test('a reason other than "Other" cancels without a note', async () => {
  const cancel = vi.fn<AdminApi['cancel']>(() => Promise.resolve(OK));
  const { user } = await openOrder({ cancel });
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  const dialog = screen.getByRole('dialog');
  await user.selectOptions(within(dialog).getByLabelText('Reason'), 'unreachable');
  expect(within(dialog).getByLabelText('Note (optional)')).toBeVisible();
  await user.click(within(dialog).getByRole('button', { name: 'Cancel order' }));
  expect(cancel).toHaveBeenCalledExactlyOnceWith('D10001', { expectedVersion: 1, reason: 'unreachable' });
});

test('a 409 says what the order is now and reloads it', async () => {
  const confirm = vi.fn(() =>
    Promise.resolve<OrderActionResult>({ ok: false, code: 'conflict', current: { orderState: 'cancelled', version: 2 } }),
  );
  const order = vi
    .fn()
    .mockResolvedValueOnce(detail())
    .mockResolvedValueOnce(detail({ orderState: 'cancelled', paymentState: 'voided', version: 2 }));
  const { user } = await openOrder({ confirm, order });

  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('radio', { name: 'WhatsApp' }));
  await user.click(within(dialog).getByRole('button', { name: 'Confirm order' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('This order changed while you were looking at it: it is now cancelled.');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(order).toHaveBeenCalledTimes(2);
  // The reloaded order is cancelled, so there is nothing left to confirm or cancel.
  expect(await screen.findByTestId('order-state')).toHaveTextContent('Cancelled');
  expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
});

test('a failed request keeps the dialog open with a message and lets the staff member try again', async () => {
  const confirm = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(OK);
  const { user } = await openOrder({ confirm });
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('radio', { name: 'WhatsApp' }));
  await user.click(within(dialog).getByRole('button', { name: 'Confirm order' }));

  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Something went wrong. Nothing was changed. Try again.');
  await user.click(within(dialog).getByRole('button', { name: 'Confirm order' }));
  expect(confirm).toHaveBeenCalledTimes(2);
});

test('an order that is already confirmed offers neither action', async () => {
  await openOrder({ order: vi.fn(() => Promise.resolve(detail({ orderState: 'confirmed', version: 2 }))) });
  expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
});
