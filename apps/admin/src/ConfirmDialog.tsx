import { CONFIRM_METHODS, MAX_NOTE_LENGTH, type ConfirmMethod, type OrderDetail } from '@dose/contract';
import { Button, Dialog, Field, LinkButton } from '@dose/ui';
import { useState, type RefObject, type SyntheticEvent } from 'react';
import { whatsappLink } from './format';
import { CONFIRM_METHOD_LABEL, fill, s } from './i18n';

export type ConfirmValues = { method: ConfirmMethod; note?: string };

export type ConfirmDialogProps = {
  order: OrderDetail;
  onClose: () => void;
  /** Sends the confirmation. Answers the message to show in the dialog, or null when it is finished (the caller closes it). */
  onSubmit: (values: ConfirmValues) => Promise<string | null>;
  returnFocusTo?: RefObject<HTMLElement | null>;
};

/**
 * Confirming a cash-on-delivery order: staff reach the customer (the WhatsApp link opens a chat
 * with the confirmation message ready, in the language the customer ordered in), then say how
 * they confirmed. The method is required, so the button stays disabled until one is chosen.
 */
export function ConfirmDialog({ order, onClose, onSubmit, returnFocusTo }: ConfirmDialogProps) {
  const [method, setMethod] = useState<ConfirmMethod | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (method === null || busy) return;
    const trimmed = note.trim();
    setBusy(true);
    setProblem(null);
    const message = await onSubmit({ method, ...(trimmed === '' ? {} : { note: trimmed }) });
    setProblem(message);
    setBusy(false);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={fill(s.confirmTitle, { number: order.number })}
      closeLabel={s.close}
      {...(returnFocusTo === undefined ? {} : { returnFocusTo })}
    >
      <form className="admin-form" onSubmit={(event) => void submit(event)}>
        <p>{s.confirmIntro}</p>
        <LinkButton variant="secondary" href={whatsappLink(order)} target="_blank" rel="noopener noreferrer">
          {s.whatsappLink}
        </LinkButton>

        <fieldset className="admin-choice">
          <legend>{s.methodLegend}</legend>
          {CONFIRM_METHODS.map((value) => (
            <label key={value} className="admin-choice__option">
              <input
                type="radio"
                name="confirm-method"
                value={value}
                checked={method === value}
                onChange={() => {
                  setMethod(value);
                }}
              />
              {CONFIRM_METHOD_LABEL[value]}
            </label>
          ))}
        </fieldset>

        <Field label={s.noteOptional}>
          {(control) => (
            <textarea
              {...control}
              rows={3}
              maxLength={MAX_NOTE_LENGTH}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          )}
        </Field>

        {problem === null ? null : (
          <p className="admin-notice admin-notice--error" role="alert">
            {problem}
          </p>
        )}
        <Button type="submit" block disabled={method === null || busy}>
          {s.confirmSubmit}
        </Button>
      </form>
    </Dialog>
  );
}
