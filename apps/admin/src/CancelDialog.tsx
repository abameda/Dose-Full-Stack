import { CANCEL_REASONS, MAX_NOTE_LENGTH, type CancelReason, type OrderDetail } from '@dose/contract';
import { Button, Dialog, Field } from '@dose/ui';
import { useState, type RefObject, type SyntheticEvent } from 'react';
import { CANCEL_REASON_LABEL, fill, s } from './i18n';

export type CancelValues = { reason: CancelReason; note?: string };

export type CancelDialogProps = {
  order: OrderDetail;
  onClose: () => void;
  /** Sends the cancellation. Answers the message to show in the dialog, or null when it is finished (the caller closes it). */
  onSubmit: (values: CancelValues) => Promise<string | null>;
  returnFocusTo?: RefObject<HTMLElement | null>;
};

function reasonOf(value: string): CancelReason | null {
  return CANCEL_REASONS.find((reason) => reason === value) ?? null;
}

/**
 * Cancelling an order: one of the seven reasons is required, and the reason "Other" also needs a
 * note saying what happened (a note of spaces does not count).
 */
export function CancelDialog({ order, onClose, onSubmit, returnFocusTo }: CancelDialogProps) {
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [note, setNote] = useState('');
  const [missingNote, setMissingNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const noteRequired = reason === 'other';

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (reason === null || busy) return;
    const trimmed = note.trim();
    if (noteRequired && trimmed === '') {
      setMissingNote(true);
      return;
    }
    setBusy(true);
    setProblem(null);
    const message = await onSubmit({ reason, ...(trimmed === '' ? {} : { note: trimmed }) });
    setProblem(message);
    setBusy(false);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={fill(s.cancelTitle, { number: order.number })}
      closeLabel={s.close}
      {...(returnFocusTo === undefined ? {} : { returnFocusTo })}
    >
      <form className="admin-form" onSubmit={(event) => void submit(event)}>
        <p>{s.cancelIntro}</p>

        <Field label={s.reasonLabel}>
          {(control) => (
            <select
              {...control}
              value={reason ?? ''}
              onChange={(event) => {
                setReason(reasonOf(event.target.value));
                setMissingNote(false);
              }}
            >
              <option value="">{s.reasonPlaceholder}</option>
              {CANCEL_REASONS.map((value) => (
                <option key={value} value={value}>
                  {CANCEL_REASON_LABEL[value]}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label={noteRequired ? s.noteRequired : s.noteOptional} error={missingNote && noteRequired ? s.noteNeeded : undefined}>
          {(control) => (
            <textarea
              {...control}
              rows={3}
              maxLength={MAX_NOTE_LENGTH}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setMissingNote(false);
              }}
            />
          )}
        </Field>

        {problem === null ? null : (
          <p className="admin-notice admin-notice--error" role="alert">
            {problem}
          </p>
        )}
        <Button type="submit" block disabled={reason === null || busy}>
          {s.cancelSubmit}
        </Button>
      </form>
    </Dialog>
  );
}
