// Direction 0, the baseline: a plain, fast storefront that is always safe to launch. Its pages are
// Astro components (Layout, HomePage, ProductPage, CheckoutPage, ConfirmationPage) that the web
// app imports by file; they take their data as props and never fetch commerce data themselves.

/** The id stored on every order this direction takes. */
export const DIRECTION_ID = 'd0-baseline';
