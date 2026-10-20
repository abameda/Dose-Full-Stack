import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { detail, fakeApi, renderAdmin, summary } from './support';

test('lists orders in a table, each number opening the order', async () => {
  const api = fakeApi('accountant', {
    orders: vi.fn(() =>
      Promise.resolve([summary({ number: 'D10002', orderState: 'confirmed' }), summary({ number: 'D10001', customerName: 'Mona' })]),
    ),
  });
  renderAdmin('/orders', api);

  const table = await screen.findByRole('table', { name: 'Orders' });
  const rows = within(table).getAllByRole('row');
  expect(rows).toHaveLength(3); // header and two orders
  expect(within(rows[1] as HTMLElement).getByRole('link', { name: 'D10002' })).toHaveAttribute('href', '/orders/D10002');
  expect(within(rows[1] as HTMLElement).getByText('Confirmed')).toBeVisible();
  expect(within(rows[2] as HTMLElement).getByText('Mona')).toBeVisible();
  expect(within(rows[2] as HTMLElement).getByText('EGP 1,234')).toBeVisible();
  expect(api.orders).toHaveBeenCalledWith({});
});

test('searches by phone number or order number when the form is sent', async () => {
  const orders = vi.fn(() => Promise.resolve([summary()]));
  renderAdmin('/orders', fakeApi('operations', { orders }));
  await screen.findByRole('table', { name: 'Orders' });
  const user = userEvent.setup();

  await user.type(screen.getByRole('searchbox', { name: 'Phone or order number' }), '010 1234 5678{Enter}');
  expect(orders).toHaveBeenLastCalledWith({ q: '010 1234 5678' });

  await user.clear(screen.getByRole('searchbox', { name: 'Phone or order number' }));
  await user.type(screen.getByRole('searchbox', { name: 'Phone or order number' }), 'd10001');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  expect(orders).toHaveBeenLastCalledWith({ q: 'd10001' });
});

test('filters by state as soon as one is chosen, and back to all', async () => {
  const orders = vi.fn(() => Promise.resolve([summary()]));
  renderAdmin('/orders', fakeApi('operations', { orders }));
  await screen.findByRole('table', { name: 'Orders' });
  const user = userEvent.setup();

  await user.selectOptions(screen.getByLabelText('State'), 'pending');
  expect(orders).toHaveBeenLastCalledWith({ state: 'pending' });
  await user.selectOptions(screen.getByLabelText('State'), '');
  expect(orders).toHaveBeenLastCalledWith({});
});

test('starts from the search and state in the address', async () => {
  const orders = vi.fn(() => Promise.resolve([]));
  renderAdmin('/orders?q=D10001&state=cancelled', fakeApi('operations', { orders }));
  expect(await screen.findByText('No orders match.')).toBeVisible();
  expect(orders).toHaveBeenCalledWith({ q: 'D10001', state: 'cancelled' });
  expect(screen.getByRole('searchbox', { name: 'Phone or order number' })).toHaveValue('D10001');
  expect(screen.getByLabelText('State')).toHaveValue('cancelled');
});

test('says the order is not there when the API has no such order', async () => {
  renderAdmin('/orders/D99999', fakeApi('operations', { order: vi.fn(() => Promise.resolve(null)) }));
  expect(await screen.findByText('There is no order D99999.')).toBeVisible();
});

test('the order page shows the customer, address, lines, totals, the three states and the timeline', async () => {
  const order = detail({
    deliveryFee: 7_000,
    timeline: [
      { at: '2026-10-20T10:00:00.000Z', actorType: 'customer', actorLabel: '+201012345678', action: 'order.placed' },
      { at: '2026-10-20T10:30:00.000Z', actorType: 'staff', actorLabel: 'Local Operations', action: 'order.cancelled', reason: 'unreachable', note: 'No answer twice' },
      { at: '2026-10-22T10:00:00.000Z', actorType: 'system', actorLabel: 'expiry', action: 'order.cancelled', reason: 'confirmation_window_expired' },
    ],
  });
  renderAdmin('/orders/D10001', fakeApi('accountant', { order: vi.fn(() => Promise.resolve(order)) }));
  await screen.findByRole('heading', { name: 'Order D10001' });

  expect(screen.getByText('Test Customer')).toBeVisible();
  expect(screen.getByText('+201012345678')).toBeVisible();
  expect(screen.getByText(/Nasr City/)).toBeVisible();
  const lines = screen.getByRole('table', { name: 'Items' });
  expect(within(lines).getByText('Paradise')).toBeVisible();
  expect(within(lines).getByText('PARADISE-50ML')).toBeVisible();

  const totals = screen.getByRole('group', { name: 'Totals' });
  expect(within(totals).getByText('EGP 1,164')).toBeVisible();
  expect(within(totals).getByText('EGP 70')).toBeVisible();
  expect(within(totals).getByText('EGP 1,234')).toBeVisible();

  // The three states, each with a sentence a person can follow.
  expect(screen.getByTestId('order-state')).toHaveTextContent('Pending');
  expect(screen.getByTestId('order-state-explanation')).toHaveTextContent(/waiting for staff to confirm/i);
  expect(screen.getByTestId('payment-state')).toHaveTextContent('Awaiting collection');
  expect(screen.getByTestId('payment-state-explanation')).toHaveTextContent(/cash on delivery/i);
  expect(screen.getByTestId('fulfilment-state')).toHaveTextContent('Unfulfilled');

  const timeline = within(screen.getByRole('list', { name: 'Timeline' })).getAllByRole('listitem');
  expect(timeline).toHaveLength(3);
  expect(timeline[0]).toHaveTextContent('Placed by customer +201012345678');
  expect(timeline[1]).toHaveTextContent('Cancelled by Local Operations · Customer unreachable');
  expect(timeline[1]).toHaveTextContent('No answer twice');
  expect(timeline[2]).toHaveTextContent('Cancelled by the system (expiry) · Confirmation window expired');
});
