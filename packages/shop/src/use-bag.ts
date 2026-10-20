import type { BagLine, CommerceActions } from '@dose/contract';
import { useEffect, useState } from 'react';

/**
 * The bag's lines, kept current. The bag lives in the browser, so the server render and the
 * first client render both see it empty (they must match); `ready` turns true once the real
 * bag has been read.
 */
export function useBag(client: CommerceActions): { lines: BagLine[]; ready: boolean } {
  const [state, setState] = useState<{ lines: BagLine[]; ready: boolean }>({ lines: [], ready: false });
  useEffect(() => {
    setState({ lines: client.lines(), ready: true });
    return client.subscribe((lines) => { setState({ lines, ready: true }); });
  }, [client]);
  return state;
}

/** A stable key for the set of SKUs in the bag: it changes when a line is added or removed, not when a quantity does. */
export function skuKey(lines: readonly BagLine[]): string {
  return lines
    .map((line) => line.sku)
    .sort()
    .join('|');
}
