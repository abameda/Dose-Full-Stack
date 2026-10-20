// Bag limits (decision 0002): 1-10 units per line, at most 10 lines. They live in their own file
// so the shop's bag store can read them without loading the Zod schemas of the contract index.
export const MAX_BAG_LINES = 10;
export const MAX_LINE_QUANTITY = 10;
