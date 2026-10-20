import { GOVERNORATES } from './governorates';

/** A delivery address in Egypt. `governorate` is a code from `GOVERNORATES` (e.g. `cairo`). */
export interface AddressInput {
  governorate: string;
  area: string;
  street: string;
  building: string;
  landmark?: string;
}

/** The longest value any address field accepts, in characters. */
export const MAX_ADDRESS_FIELD = 200;

const GOVERNORATE_CODES = new Set(GOVERNORATES.map((g) => g.code));

/** The trimmed text when it is 1 to `MAX_ADDRESS_FIELD` characters, else null. */
function text(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= MAX_ADDRESS_FIELD ? trimmed : null;
}

/**
 * Checks an address typed at checkout. Fields are trimmed; the governorate must be one of the
 * 27 codes; area, street and building are required; a blank landmark is dropped. Whether cash
 * on delivery is offered in the governorate is a database setting, checked by the checkout.
 */
export function validateAddress(
  a: AddressInput,
): { ok: true; value: AddressInput } | { ok: false; fields: (keyof AddressInput)[] } {
  const governorate = GOVERNORATE_CODES.has(a.governorate) ? a.governorate : null;
  const area = text(a.area);
  const street = text(a.street);
  const building = text(a.building);
  const blankLandmark = a.landmark === undefined || a.landmark.trim() === '';
  const landmark = blankLandmark ? undefined : text(a.landmark ?? '');

  if (governorate === null || area === null || street === null || building === null || landmark === null) {
    const fields: (keyof AddressInput)[] = [];
    if (governorate === null) fields.push('governorate');
    if (area === null) fields.push('area');
    if (street === null) fields.push('street');
    if (building === null) fields.push('building');
    if (landmark === null) fields.push('landmark');
    return { ok: false, fields };
  }
  return {
    ok: true,
    value: { governorate, area, street, building, ...(landmark === undefined ? {} : { landmark }) },
  };
}
