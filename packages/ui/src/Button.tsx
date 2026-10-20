import type { ComponentPropsWithRef } from 'react';

type Look = {
  /** `primary` is the one main action on a screen; `secondary` and `quiet` are for the rest. */
  variant?: 'primary' | 'secondary' | 'quiet' | undefined;
  /** Fills the width of its container. */
  block?: boolean | undefined;
};

function classes({ variant = 'primary', block = false }: Look, extra: string | undefined): string {
  return ['dose-btn', variant === 'primary' ? '' : `dose-btn--${variant}`, block ? 'dose-btn--block' : '', extra ?? '']
    .filter((name) => name !== '')
    .join(' ');
}

export type ButtonProps = Look & ComponentPropsWithRef<'button'>;

/** A button. It defaults to `type="button"` so it never submits a form by accident. */
export function Button({ variant, block, className, type = 'button', ...rest }: ButtonProps) {
  return <button {...rest} type={type} className={classes({ variant, block }, className)} />;
}

export type LinkButtonProps = Look & ComponentPropsWithRef<'a'>;

/** A link that looks like a button: it goes somewhere, so it is an `<a>`, not a `<button>`. */
export function LinkButton({ variant, block, className, ...rest }: LinkButtonProps) {
  return <a {...rest} className={classes({ variant, block }, className)} />;
}
