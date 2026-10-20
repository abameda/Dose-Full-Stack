import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fakeApi, renderAdmin, summary, today } from './support';

// Today is the inbox: it refreshes by itself every five seconds and when the window gets focus.
// Fake timers drive the clock, so the tests flush promises with `advanceTimersByTimeAsync`.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

test('shows the count, the oldest waiting time and one row per order, each opening the order', async () => {
  const api = fakeApi('operations', {
    today: vi.fn(() =>
      Promise.resolve(
        today([summary({ number: 'D10001' }), summary({ number: 'D10002', customerName: 'Second Customer', total: 50_000 })], 135),
      ),
    ),
  });
  renderAdmin('/', api);
  await settle();

  expect(screen.getByRole('heading', { name: 'Orders to confirm' })).toBeVisible();
  expect(screen.getByTestId('to-confirm-count')).toHaveTextContent('2');
  expect(screen.getByText('Oldest has waited 2 hours 15 minutes')).toBeVisible();

  const rows = within(screen.getByRole('list', { name: 'Orders to confirm' })).getAllByRole('listitem');
  expect(rows).toHaveLength(2);
  const first = within(rows[0] as HTMLElement).getByRole('link', { name: /D10001/ });
  expect(first).toHaveAttribute('href', '/orders/D10001');
  expect(within(rows[1] as HTMLElement).getByText('Second Customer')).toBeVisible();
  expect(within(rows[1] as HTMLElement).getByText('EGP 500')).toBeVisible();
});

test('says so when nothing waits', async () => {
  const api = fakeApi('operations', { today: vi.fn(() => Promise.resolve(today([]))) });
  renderAdmin('/', api);
  await settle();
  expect(screen.getByText('Nothing is waiting for confirmation.')).toBeVisible();
  expect(screen.getByTestId('to-confirm-count')).toHaveTextContent('0');
});

test('refreshes every 5 seconds, and a new order appears without a reload', async () => {
  const today_ = vi
    .fn()
    .mockResolvedValueOnce(today([]))
    .mockResolvedValue(today([summary({ number: 'D10007' })], 0));
  renderAdmin('/', fakeApi('operations', { today: today_ }));
  await settle();
  expect(today_).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('link', { name: /D10007/ })).toBeNull();

  await settle(4_900);
  expect(today_).toHaveBeenCalledTimes(1);
  await settle(200);
  expect(today_).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('link', { name: /D10007/ })).toBeVisible();
  expect(screen.getByText('Oldest has waited less than a minute')).toBeVisible();

  await settle(5_000);
  expect(today_).toHaveBeenCalledTimes(3);
});

test('refreshes when the window gets focus, and when the tab becomes visible again', async () => {
  const today_ = vi.fn(() => Promise.resolve(today([])));
  renderAdmin('/', fakeApi('operations', { today: today_ }));
  await settle();
  expect(today_).toHaveBeenCalledTimes(1);

  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(today_).toHaveBeenCalledTimes(2);

  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(today_).toHaveBeenCalledTimes(3);
});

test('keeps the last list on screen, with a notice, when a refresh fails', async () => {
  const today_ = vi
    .fn()
    .mockResolvedValueOnce(today([summary()]))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(today([summary()]));
  renderAdmin('/', fakeApi('operations', { today: today_ }));
  await settle();
  await settle(5_000);
  expect(screen.getByRole('link', { name: /D10001/ })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('Could not refresh. Showing the last list.');

  await settle(5_000);
  expect(screen.queryByText('Could not refresh. Showing the last list.')).toBeNull();
});

test('stops refreshing when the page is left', async () => {
  const today_ = vi.fn(() => Promise.resolve(today([])));
  const { unmount } = renderAdmin('/', fakeApi('operations', { today: today_ }));
  await settle();
  unmount();
  await settle(20_000);
  expect(today_).toHaveBeenCalledTimes(1);
});
