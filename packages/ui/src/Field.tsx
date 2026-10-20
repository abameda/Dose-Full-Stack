import { useId, type ReactNode } from 'react';

/** What a form control must be given so the label, hint and error belong to it. */
export type FieldControlProps = {
  id: string;
  className: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
};

export type FieldProps = {
  label: string;
  /** Help shown under the control, read out with it. */
  hint?: string | undefined;
  /** What is wrong, shown under the control, read out with it, and marks the control invalid. */
  error?: string | undefined;
  /** Renders the control (`<input>`, `<select>`, ...) with the props it must carry. */
  children: (control: FieldControlProps) => ReactNode;
};

/**
 * A labelled form control. The label is tied to the control by `for`/`id`; the hint and the
 * error are tied to it by `aria-describedby`, so a screen reader reads them when the control
 * takes focus; an error also sets `aria-invalid`.
 */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint === undefined ? '' : hintId, error === undefined ? '' : errorId].filter((x) => x !== '').join(' ');

  return (
    <div className="dose-field">
      <label className="dose-field__label" htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        className: 'dose-field__control',
        'aria-describedby': describedBy === '' ? undefined : describedBy,
        'aria-invalid': error === undefined ? undefined : true,
      })}
      {hint === undefined ? null : (
        <p className="dose-field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p className="dose-field__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}
