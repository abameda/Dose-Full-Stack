// Money formatting moved to @dose/contract/money, because the storefront formats prices too and
// may not import this package. Core keeps its own import path.
export { assertPiastres, formatEgp } from '@dose/contract/money';
