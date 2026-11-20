import { ALL_UNITS } from '@mise/domain';
import { unitName, useT } from '../i18n/index.js';

/**
 * Every unit as the options of a select, named in the reader's language:
 * "stuk" in Dutch, not "each". The value stays the stored code, so a recipe
 * written in one language reads the same in another.
 */
export function UnitOptions() {
  const { t } = useT();
  return (
    <>
      {ALL_UNITS.map((u) => (
        <option key={u.code} value={u.code}>
          {unitName(t, u.code)}
        </option>
      ))}
    </>
  );
}
