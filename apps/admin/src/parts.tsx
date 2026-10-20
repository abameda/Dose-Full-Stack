import type { OrderState } from '@dose/contract';
import { Button } from '@dose/ui';
import type { ReactNode } from 'react';
import { AdminApiError } from './api';
import type { Load } from './hooks';
import { ORDER_STATE_LABEL, s } from './i18n';

/** Shows what a load is doing: a loading line, an error with a retry, or the loaded value. */
export function LoadGate<T>({
  state,
  retry,
  errorText = s.loadFailed,
  children,
}: {
  state: Load<T>;
  retry: () => void;
  errorText?: string;
  children: (value: T, refreshFailed: boolean) => ReactNode;
}) {
  if (state.status === 'loading') {
    return (
      <p className="admin-muted" role="status">
        {s.loading}
      </p>
    );
  }
  if (state.status === 'error') {
    const signedOut = state.error instanceof AdminApiError && (state.error.status === 401 || state.error.status === 403);
    return (
      <div className="admin-notice admin-notice--error" role="alert">
        <p>{signedOut ? s.notSignedIn : errorText}</p>
        {signedOut ? null : (
          <Button variant="secondary" onClick={retry}>
            {s.tryAgain}
          </Button>
        )}
      </div>
    );
  }
  return <>{children(state.value, state.refreshFailed)}</>;
}

/** An order state as a coloured label (the text says it too; colour alone never does). */
export function StateBadge({ state }: { state: OrderState }) {
  return <span className={`admin-badge admin-badge--${state}`}>{ORDER_STATE_LABEL[state]}</span>;
}
