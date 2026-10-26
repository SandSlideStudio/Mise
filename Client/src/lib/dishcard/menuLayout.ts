import type { MenuOverview } from '@mise/contracts';
import { COURSES, DISH_CARD_ALLERGEN_ORDER } from '@mise/domain';
import { cardAllergenName, courseName } from '../../i18n/index.js';
import { PT_TO_MM, type CardFontKey, type CardFonts } from './fonts.js';
import type { CardIcon } from './icons.js';
import {
  ascentMm,
  createKit,
  lineMm,
  MARGIN,
  PAGE_W,
  type CardPage,
  type LayoutOptions,
  type Op,
} from './layout.js';

/**
 * A menu's allergen overview: every dish down the side, the fourteen allergens
 * and vegan across the top, in the dish card's own look. It answers "what can
 * table six have?" for the whole menu at once.
 *
 * A long menu runs onto more pages, each with the column heads repeated, so a
 * sheet taken off the clipboard still reads on its own.
 */

type Row =
  { kind: 'course'; label: string } | { kind: 'dish'; dish: MenuOverview['dishes'][number] };

export function layoutMenuOverview(
  overview: MenuOverview,
  fonts: CardFonts,
  options: LayoutOptions,
): CardPage[] {
  // Not a dish card, so the line over the page is just the kitchen.
  const kit = createKit(
    fonts,
    options,
    overview.settings,
    overview.kitchenName,
    overview.kitchenName,
  );
  const { t, p, shows, upper, wrap, text, block, width, footer, eyebrow } = kit;
  const x = MARGIN;
  const right = PAGE_W - MARGIN;
  const w = right - x;

  const allergens = DISH_CARD_ALLERGEN_ORDER;
  const vegan = shows('vegan');
  const mayContain = shows('mayContain');
  const nameW = 62;
  const columns = allergens.length + (vegan ? 1 : 0);
  const colW = (w - nameW) / columns;

  // Course bands between the dishes, in menu order.
  const rows: Row[] = [];
  let lastCourse: string | null | undefined;
  for (const dish of overview.dishes) {
    if (dish.course !== lastCourse) {
      rows.push({
        kind: 'course',
        label: dish.course ? courseName(t, dish.course) : t('menus.noCourse'),
      });
      lastCourse = dish.course;
    }
    rows.push({ kind: 'dish', dish });
  }
  const showCourses = overview.dishes.some((dish) => dish.course !== null);
  const body = showCourses ? rows : rows.filter((row) => row.kind === 'dish');

  const centred = (
    ops: Op[],
    value: string,
    cx: number,
    cy: number,
    cw: number,
    ch: number,
    font: CardFontKey,
    size: number,
    color: string,
  ) => {
    text(
      ops,
      value,
      cx + (cw - width(value, font, size)) / 2,
      cy + (ch + size * 0.7 * PT_TO_MM) / 2,
      font,
      size,
      color,
    );
  };

  const headLabels = [
    ...allergens.map((a) => cardAllergenName(t, a)),
    ...(vegan ? [t('card.vegan')] : []),
  ].map((label) => wrap(label, 'medium', 8, colW - 1.2).slice(0, 3));
  const headH =
    2.2 + 5.3 + 1.3 + Math.max(...headLabels.map((l) => l.length)) * lineMm(8, 1.1) + 1.6;
  const dishH = 8.6;
  const courseH = 6.4;

  function pageTop(ops: Op[]): number {
    let y = eyebrow(ops, x, w);
    const name = upper(overview.menu.name);
    const suffix = ` / ${upper(t('menus.overviewTitle'))}`;
    let size = 28;
    while (size > 16 && width(name + suffix, 'condSemibold', size) > w) size -= 1;
    const baseline = y + 1.5 + size * 0.7 * PT_TO_MM;
    text(ops, name, x, baseline, 'condSemibold', size, p.ink);
    text(
      ops,
      suffix,
      x + width(name, 'condSemibold', size),
      baseline,
      'condSemibold',
      size,
      p.faint,
    );
    y = baseline + 5.5;
    return y;
  }

  function header(ops: Op[], y: number) {
    ops.push({ kind: 'rect', x, y, w: nameW, h: headH, fill: p.head });
    text(
      ops,
      upper(t('menus.dish')),
      x + 2.5,
      y + headH - 1.6 - lineMm(8, 1.1) + ascentMm(8),
      'condMedium',
      8,
      p.soft,
      0.12,
    );
    headLabels.forEach((lines, i) => {
      const cx = x + nameW + i * colW;
      const isVegan = vegan && i === allergens.length;
      ops.push({ kind: 'rect', x: cx, y, w: colW, h: headH, fill: isVegan ? p.veganHead : p.head });
      const ink = isVegan ? p.veganHeadInk : p.ink;
      const icon: CardIcon = isVegan ? 'vegan' : allergens[i]!;
      ops.push({ kind: 'icon', icon, x: cx + (colW - 5.3) / 2, y: y + 2.2, size: 5.3, color: ink });
      const labelTop = y + headH - 1.6 - lines.length * lineMm(8, 1.1);
      lines.forEach((line, n) =>
        text(
          ops,
          line,
          cx + (colW - width(line, 'medium', 8)) / 2,
          labelTop + ascentMm(8) + n * lineMm(8, 1.1),
          'medium',
          8,
          isVegan ? ink : p.soft,
        ),
      );
    });
    return y + headH;
  }

  function drawRow(ops: Op[], row: Row, y: number): number {
    if (row.kind === 'course') {
      ops.push({ kind: 'rect', x, y, w, h: courseH, fill: p.head });
      text(
        ops,
        upper(row.label),
        x + 2.5,
        y + courseH / 2 + 8.5 * 0.34 * PT_TO_MM,
        'condSemibold',
        8.5,
        p.kick,
        0.14,
      );
      return y + courseH;
    }
    const { dish } = row;
    const lines = wrap(dish.name, 'medium', 10, nameW - 5).slice(0, 2);
    const blockH = lines.length * lineMm(10, 1.12);
    lines.forEach((line, n) =>
      text(
        ops,
        line,
        x + 2.5,
        y + (dishH - blockH) / 2 + ascentMm(10) + n * lineMm(10, 1.12),
        'medium',
        10,
        p.ink,
      ),
    );
    allergens.forEach((allergen, i) => {
      const cx = x + nameW + i * colW;
      if (dish.contains.includes(allergen)) {
        ops.push({ kind: 'rect', x: cx, y, w: colW, h: dishH, fill: p.accent });
        centred(ops, 'X', cx, y, colW, dishH, 'condSemibold', 12, p.onAccent);
      } else if (mayContain && dish.mayContain.includes(allergen)) {
        centred(ops, '(X)', cx, y, colW, dishH, 'condSemibold', 10.5, p.accent);
      }
    });
    if (vegan) {
      const cx = x + nameW + allergens.length * colW;
      if (dish.vegan === 'yes') {
        ops.push({
          kind: 'icon',
          icon: 'check',
          x: cx + (colW - 4.2) / 2,
          y: y + (dishH - 4.2) / 2,
          size: 4.2,
          color: p.vegan,
        });
      } else if (dish.vegan === 'unknown') {
        centred(ops, '?', cx, y, colW, dishH, 'condSemibold', 11, p.faint);
      }
    }
    return y + dishH;
  }

  function grid(ops: Op[], top: number, bottom: number, dividers: number[]) {
    for (const ly of dividers)
      ops.push({ kind: 'line', x1: x, y1: ly, x2: right, y2: ly, color: p.rule });
    for (let col = 0; col <= columns; col++) {
      const lx = x + nameW + col * colW;
      ops.push({ kind: 'line', x1: lx, y1: top, x2: lx, y2: bottom, color: p.rule });
    }
    ops.push({ kind: 'rect', x, y: top, w, h: bottom - top, stroke: p.line });
  }

  /** The key and which cereal or nut, drawn once under the last table. */
  function key(ops: Op[], top: number): number {
    let y = top + 4.5;
    let kx = x;
    const keySize = 9;
    const item = (draw: (at: number) => number, label: string) => {
      const used = draw(kx);
      text(
        ops,
        label,
        kx + used + 1.6,
        y + 2.6 + keySize * 0.34 * PT_TO_MM,
        'regular',
        keySize,
        p.soft,
      );
      kx += used + 1.6 + width(label, 'regular', keySize) + 6.5;
    };
    const swatch = (fill: boolean, mark: string) => (at: number) => {
      const sw = Math.max(5.2, width(mark, 'condSemibold', 9.5) + 2.4);
      ops.push(
        fill
          ? { kind: 'rect', x: at, y, w: sw, h: 5.2, fill: p.accent }
          : { kind: 'rect', x: at, y, w: sw, h: 5.2, stroke: p.accent },
      );
      centred(ops, mark, at, y, sw, 5.2, 'condSemibold', 9.5, fill ? p.onAccent : p.accent);
      return sw;
    };
    item(swatch(true, 'X'), t('card.keyContains'));
    if (mayContain) item(swatch(false, '(X)'), t('card.keyMayContain'));
    if (vegan) {
      item((at) => {
        ops.push({ kind: 'icon', icon: 'check', x: at, y: y + 0.6, size: 4, color: p.vegan });
        return 4;
      }, t('card.keyVegan'));
      if (overview.dishes.some((dish) => dish.vegan === 'unknown')) {
        item((at) => {
          centred(ops, '?', at, y, 4, 5.2, 'condSemibold', 11, p.faint);
          return 4;
        }, t('card.keyUnknown'));
      }
    }

    y += 5.2 + 3.5;
    const named = overview.dishes
      .map((dish) => {
        const names = [...dish.gluten, ...dish.nuts];
        const missing =
          (dish.contains.includes('gluten') && dish.gluten.length === 0) ||
          (dish.contains.includes('nuts') && dish.nuts.length === 0);
        if (names.length === 0 && !missing) return null;
        return `${dish.name}: ${[...names, ...(missing ? [t('card.unnamed')] : [])].join(', ')}`;
      })
      .filter((line): line is string => line !== null);
    const label = `${t('card.cerealsAndNuts')}:`;
    text(ops, label, x, y + ascentMm(9.5), 'semibold', 9.5, p.ink);
    const labelW = width(label, 'semibold', 9.5) + 1.6;
    return block(
      ops,
      named.length > 0 ? named.join(' · ') : t('card.noCerealsOrNuts'),
      x + labelW,
      y,
      w - labelW,
      'regular',
      9.5,
      p.soft,
    );
  }

  // Lay the rows out page by page. The footer is the same height on every
  // page, so measure it once on a scratch page.
  const footTop = footer([], x, right, 1, 1);
  const keyRoom = 22;
  const pages: Op[][] = [];
  let index = 0;
  do {
    const ops: Op[] = [];
    const tableTop = pageTop(ops);
    let y = header(ops, tableTop);
    const dividers: number[] = [y];
    const limit = footTop - 6;
    while (index < body.length) {
      const row = body[index]!;
      const h = row.kind === 'course' ? courseH : dishH;
      const isLast = index === body.length - 1;
      // Leave room for the key under the last row, and never end a page on a course band.
      const needed = h + (isLast ? keyRoom : 0) + (row.kind === 'course' ? dishH : 0);
      if (y + needed > limit && y > tableTop + headH) break;
      y = drawRow(ops, row, y);
      dividers.push(y);
      index += 1;
    }
    grid(ops, tableTop, y, dividers);
    if (index >= body.length) key(ops, y);
    pages.push(ops);
  } while (index < body.length);

  return pages.map((ops, i) => {
    footer(ops, x, right, i + 1, pages.length);
    return { background: p.page, ops };
  });
}

/** Course order as a menu reads it; used to group dishes on screen the same way. */
export function courseIndex(course: string | null): number {
  const i = course ? COURSES.indexOf(course as (typeof COURSES)[number]) : -1;
  return i === -1 ? COURSES.length : i;
}
