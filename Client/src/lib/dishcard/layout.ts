import type {
  DishCard,
  DishCardFacts,
  DishCardPart,
  DishCardSettings,
  DishCardTheme,
  Language,
} from '@mise/contracts';
import { DISH_CARD_ALLERGEN_ORDER, type Allergen } from '@mise/domain';
import {
  cardAllergenName,
  courseName,
  createTranslator,
  seasonName,
  temperatureName,
} from '../../i18n/index.js';
import { measure, PT_TO_MM, type CardFontKey, type CardFonts } from './fonts.js';
import type { CardIcon } from './icons.js';

/**
 * Where everything on a dish card goes.
 *
 * One layout, worked out once in millimetres, and drawn three ways: as SVG
 * for the preview and for printing, and into a PDF. Text is measured with
 * the same font files the PDF embeds, so a line breaks in the same place on
 * screen, on paper and in the download.
 *
 * Two A4 landscape pages. The front is the dish: its photograph down the left
 * edge, then what it is, what is in it and what goes with it. The back is
 * every allergen for every component.
 */

export type Op =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: string }
  | {
      kind: 'text';
      x: number;
      /** The baseline. */
      y: number;
      text: string;
      font: CardFontKey;
      /** Points. */
      size: number;
      color: string;
      /** Extra space after each letter, in em. */
      tracking?: number;
    }
  | { kind: 'icon'; icon: CardIcon; x: number; y: number; size: number; color: string }
  | {
      kind: 'image';
      x: number;
      y: number;
      w: number;
      h: number;
      src: string;
      fit: 'cover' | 'contain';
    };

export interface CardPage {
  background: string;
  ops: Op[];
}

export const PAGE_W = 297;
export const PAGE_H = 210;
/** Hairlines, in millimetres. */
export const HAIRLINE = 0.3;

interface Palette {
  page: string;
  ink: string;
  soft: string;
  faint: string;
  footFaint: string;
  line: string;
  rule: string;
  head: string;
  kick: string;
  accent: string;
  onAccent: string;
  veganHead: string;
  veganHeadInk: string;
  vegan: string;
}

/** Mise's own night and day colours. */
const PALETTES: Record<DishCardTheme, Palette> = {
  night: {
    page: '#1a1c16',
    ink: '#f2f0e4',
    soft: '#b3b6a2',
    faint: '#8f9282',
    footFaint: '#6f7264',
    line: '#4a4f3d',
    rule: '#3d4234',
    head: '#24271e',
    kick: '#9cb173',
    accent: '#e3ab5b',
    onAccent: '#1a1c16',
    veganHead: '#4a5c33',
    veganHeadInk: '#f6f4e8',
    vegan: '#9cb173',
  },
  day: {
    page: '#ffffff',
    ink: '#2a2c22',
    soft: '#5d5f52',
    faint: '#6b6d5f',
    footFaint: '#8f9282',
    line: '#cdc9b9',
    rule: '#e2dfd3',
    head: '#f2efe4',
    kick: '#3c4a2a',
    accent: '#8a5c1a',
    onAccent: '#ffffff',
    veganHead: '#3c4a2a',
    veganHeadInk: '#f6f4e8',
    vegan: '#3c4a2a',
  },
};

export interface LayoutOptions {
  language: Language;
  /** Whose warning to fall back on when the card's language has none. */
  kitchenLanguage: Language;
  theme: DishCardTheme;
  printedAt: Date;
}

export const MARGIN = 15;
export const TOP = 14;
const BOTTOM = 9;

/** Where a long word may break: the translations mark it in the column names. */
const SOFT_HYPHEN = '\u00ad';
const clean = (text: string) => text.replaceAll(SOFT_HYPHEN, '');

/** Height of a line of text at a size, in millimetres. */
export const lineMm = (sizePt: number, leading = 1.25) => sizePt * leading * PT_TO_MM;
/** From the top of a line to its baseline, near enough for Barlow. */
export const ascentMm = (sizePt: number) => sizePt * 0.78 * PT_TO_MM;

/**
 * What every printed page shares: the type, the palette, the heading over the
 * page and the foot under it. Used by the dish card and the menu overview.
 */
export function createKit(
  fonts: CardFonts,
  options: LayoutOptions,
  settings: DishCardSettings,
  kitchenName: string,
) {
  const { t, locale } = createTranslator(options.language);
  const p = PALETTES[options.theme];
  const hidden = new Set<DishCardPart>(settings.hidden);
  const shows = (part: DishCardPart) => !hidden.has(part);
  const upper = (text: string) => text.toLocaleUpperCase(locale);

  // --- text ------------------------------------------------------------------

  function wrap(text: string, font: CardFontKey, size: number, width: number, tracking = 0) {
    const fits = (s: string) => measure(fonts, font, clean(s), size, tracking) <= width;
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (fits(candidate)) {
        line = candidate;
        continue;
      }
      if (line) lines.push(clean(line));
      // A word wider than the column breaks at a marked syllable, or failing
      // that wherever it has to, rather than spilling over.
      let rest = word;
      while (!fits(rest)) {
        const syllables = rest.split(SOFT_HYPHEN);
        let cut = syllables.length - 1;
        while (cut > 0 && !fits(`${syllables.slice(0, cut).join('')}-`)) cut -= 1;
        if (cut > 0) {
          lines.push(`${clean(syllables.slice(0, cut).join(''))}-`);
          rest = syllables.slice(cut).join(SOFT_HYPHEN);
          continue;
        }
        const plain = clean(rest);
        let at = plain.length - 1;
        while (at > 1 && !fits(`${plain.slice(0, at)}-`)) at -= 1;
        lines.push(`${plain.slice(0, at)}-`);
        rest = plain.slice(at);
      }
      line = rest;
    }
    if (line) lines.push(clean(line));
    return lines;
  }

  function text(
    ops: Op[],
    value: string,
    x: number,
    y: number,
    font: CardFontKey,
    size: number,
    color: string,
    tracking = 0,
  ) {
    ops.push({ kind: 'text', x, y, text: clean(value), font, size, color, tracking });
  }

  /** Draw wrapped text from a top edge; returns the bottom edge. */
  function block(
    ops: Op[],
    value: string,
    x: number,
    top: number,
    width: number,
    font: CardFontKey,
    size: number,
    color: string,
    options: { leading?: number; tracking?: number; maxLines?: number } = {},
  ) {
    let lines = wrap(value, font, size, width, options.tracking);
    if (options.maxLines && lines.length > options.maxLines) {
      lines = lines.slice(0, options.maxLines);
      lines[lines.length - 1] = `${lines[lines.length - 1]!.replace(/-$/, '')}…`;
    }
    const step = lineMm(size, options.leading);
    lines.forEach((line, i) =>
      text(ops, line, x, top + ascentMm(size) + i * step, font, size, color, options.tracking),
    );
    return top + lines.length * step;
  }

  const width = (value: string, font: CardFontKey, size: number, tracking = 0) =>
    measure(fonts, font, clean(value), size, tracking);

  // --- shared pieces ------------------------------------------------------------

  const heading = settings.title ?? `${t('card.title')} · ${kitchenName}`;
  const warning =
    settings.warnings[options.language] ??
    settings.warnings[options.kitchenLanguage] ??
    Object.values(settings.warnings).find(Boolean) ??
    null;
  const location = shows('location')
    ? [settings.locationName, settings.address].filter(Boolean).join(' · ')
    : '';
  const printed = t('card.printed', {
    date: options.printedAt.toLocaleDateString(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }),
  });

  /** The foot of a page, laid from the bottom up. Returns its top edge. */
  function footer(ops: Op[], x: number, right: number, page: number, pages: number): number {
    const w = right - x;
    const parts: { lines: string[]; font: CardFontKey; size: number; color: string }[] = [];
    if (location)
      parts.push({
        lines: wrap(location, 'regular', 8.5, w),
        font: 'regular',
        size: 8.5,
        color: p.ink,
      });
    if (warning) {
      parts.push({
        lines: wrap(warning, 'regular', 6.3, w),
        font: 'regular',
        size: 6.3,
        color: p.faint,
      });
    }
    const last = { size: 5.8 };
    let height = lineMm(last.size, 1.3);
    for (const part of parts) height += part.lines.length * lineMm(part.size, 1.38) + 1.4;

    let y = PAGE_H - BOTTOM - height;
    const top = y;
    for (const part of parts) {
      for (const line of part.lines) {
        text(ops, line, x, y + ascentMm(part.size), part.font, part.size, part.color);
        y += lineMm(part.size, 1.38);
      }
      y += 1.4;
    }
    const baseline = y + ascentMm(last.size);
    text(ops, t('card.madeWithMise'), x, baseline, 'regular', last.size, p.footFaint);
    const pageText = `${printed} · ${t('card.page', { page, pages })}`;
    text(
      ops,
      pageText,
      right - width(pageText, 'regular', last.size),
      baseline,
      'regular',
      last.size,
      p.footFaint,
    );
    return top;
  }

  function eyebrow(ops: Op[], x: number, maxWidth: number) {
    const value = upper(heading);
    const lines = wrap(value, 'condSemibold', 10, maxWidth, 0.18).slice(0, 1);
    text(ops, lines[0] ?? '', x, TOP + ascentMm(10), 'condSemibold', 10, p.kick, 0.18);
    return TOP + lineMm(10, 1.1);
  }

  return { t, locale, p, shows, upper, wrap, text, block, width, footer, eyebrow };
}

export function layoutDishCard(card: DishCard, fonts: CardFonts, options: LayoutOptions) {
  const { t, locale, p, shows, upper, wrap, text, block, width, footer, eyebrow } = createKit(
    fonts,
    options,
    card.settings,
    card.kitchenName,
  );

  function chip(
    ops: Op[],
    x: number,
    y: number,
    label: string,
    style: 'filled' | 'outline' | 'vegan' | 'quiet',
    icon?: CardIcon,
  ) {
    const size = 9.5;
    const h = 6.4;
    const iconSize = icon ? 3.9 : 0;
    const w = 2.6 + (icon ? iconSize + 1.4 : 0) + width(label, 'semibold', size) + 2.6;
    const color =
      style === 'filled'
        ? p.onAccent
        : style === 'vegan'
          ? p.vegan
          : style === 'quiet'
            ? p.faint
            : p.accent;
    if (style === 'filled') ops.push({ kind: 'rect', x, y, w, h, fill: p.accent });
    else ops.push({ kind: 'rect', x, y, w, h, stroke: style === 'outline' ? p.accent : color });
    let cx = x + 2.6;
    if (icon) {
      ops.push({ kind: 'icon', icon, x: cx, y: y + (h - iconSize) / 2, size: iconSize, color });
      cx += iconSize + 1.4;
    }
    text(ops, label, cx, y + h / 2 + size * 0.34 * PT_TO_MM, 'semibold', size, color);
    return w;
  }

  // --- the front ------------------------------------------------------------------

  function front(): CardPage {
    const ops: Op[] = [];
    const photo = shows('photo') ? card.dish.photoUrl : null;
    const logo = shows('logo') ? card.settings.logoUrl : null;
    const x = photo ? 133 : MARGIN;
    const right = PAGE_W - MARGIN;
    const w = right - x;

    if (photo) ops.push({ kind: 'image', x: 0, y: 0, w: 120, h: PAGE_H, src: photo, fit: 'cover' });
    const logoSize = 17;
    if (logo) {
      ops.push({
        kind: 'image',
        x: right - logoSize,
        y: TOP,
        w: logoSize,
        h: logoSize,
        src: logo,
        fit: 'contain',
      });
    }

    const headWidth = w - (logo ? logoSize + 4 : 0);
    let y = eyebrow(ops, x, headWidth);

    // The name, as large as fits on two lines.
    const name = upper(card.dish.name);
    let size = 46;
    let lines = wrap(name, 'condSemibold', size, headWidth);
    for (const next of [40, 34, 28, 24]) {
      if (lines.length <= 2) break;
      size = next;
      lines = wrap(name, 'condSemibold', size, headWidth);
    }
    const step = size * 0.95 * PT_TO_MM;
    let baseline = y + 1.5 + size * 0.7 * PT_TO_MM;
    for (const line of lines.slice(0, 2)) {
      text(ops, line, x, baseline, 'condSemibold', size, p.ink);
      baseline += step;
    }
    y = baseline - step + 7;
    if (logo) y = Math.max(y, TOP + logoSize + 4);

    // What the dish is, in a row of boxes.
    const facts: [string, string][] = [];
    const dish = card.dish;
    if (shows('season') && dish.seasons.length > 0) {
      facts.push([t('card.season'), dish.seasons.map((s) => seasonName(t, s)).join(', ')]);
    }
    if (shows('flavour') && dish.flavourProfile.length > 0) {
      facts.push([t('card.flavour'), dish.flavourProfile.join(' / ')]);
    }
    if (shows('temperature') && dish.servingTemperature) {
      facts.push([t('card.temperature'), temperatureName(t, dish.servingTemperature)]);
    }
    if (shows('course') && dish.course) facts.push([t('card.course'), courseName(t, dish.course)]);

    if (facts.length > 0) {
      const cellW = w / facts.length;
      const laid = facts.map(([label, value]) => ({
        label: wrap(upper(label), 'condMedium', 8, cellW - 6, 0.12).slice(0, 1)[0] ?? '',
        value: wrap(value, 'medium', 11, cellW - 6),
      }));
      const tallest = Math.max(...laid.map((cell) => cell.value.length));
      const h = 2.6 + lineMm(8, 1.2) + 0.6 + tallest * lineMm(11, 1.18) + 2.2;
      ops.push({ kind: 'rect', x, y, w, h, stroke: p.line });
      laid.forEach((cell, i) => {
        const cx = x + i * cellW;
        if (i > 0) ops.push({ kind: 'line', x1: cx, y1: y, x2: cx, y2: y + h, color: p.line });
        text(ops, cell.label, cx + 3, y + 2.6 + ascentMm(8), 'condMedium', 8, p.faint, 0.12);
        cell.value.forEach((line, n) =>
          text(
            ops,
            line,
            cx + 3,
            y + 2.6 + lineMm(8, 1.2) + 0.6 + ascentMm(11) + n * lineMm(11, 1.18),
            'medium',
            11,
            p.ink,
          ),
        );
      });
      y += h + 7;
    }

    const footTop = footer(ops, x, right, 1, 2);

    // Components on the left, what goes with the dish on the right. Tightened
    // a step at a time if a long dish would run into the foot.
    const gap = 9;
    const leftW = ((w - gap) * 1.2) / 2.2;
    const rightX = x + leftW + gap;
    const rightW = w - leftW - gap;
    for (const scale of [1, 0.92, 0.84, 0.76, 0.68]) {
      const attempt: Op[] = [];
      const bottom = columns(attempt, x, rightX, y, leftW, rightW, scale);
      if (bottom <= footTop - 4 || scale === 0.68) {
        ops.push(...attempt);
        break;
      }
    }

    return { background: p.page, ops };
  }

  function sectionHead(ops: Op[], label: string, x: number, y: number, w: number) {
    const lines = wrap(upper(label), 'condSemibold', 9.5, w, 0.14).slice(0, 1);
    text(ops, lines[0] ?? '', x, y + ascentMm(9.5), 'condSemibold', 9.5, p.faint, 0.14);
    return y + lineMm(9.5, 1.1) + 2.2;
  }

  function columns(
    ops: Op[],
    x: number,
    rightX: number,
    top: number,
    leftW: number,
    rightW: number,
    scale: number,
  ): number {
    const size = 11 * scale;
    let left = top;
    const names = [...card.rows.map((row) => row.name), ...(card.other ? [t('card.other')] : [])];
    if (names.length > 0) {
      left = sectionHead(ops, t('card.components'), x, left, leftW);
      names.forEach((name, i) => {
        const pad = 1.5 * scale;
        text(
          ops,
          String(i + 1).padStart(2, '0'),
          x,
          left + pad + ascentMm(size),
          'condSemibold',
          size,
          p.accent,
        );
        const isOther = card.other && i === names.length - 1;
        left = block(
          ops,
          name,
          x + 6.5,
          left + pad,
          leftW - 6.5,
          isOther ? 'regular' : 'medium',
          size,
          isOther ? p.soft : p.ink,
          { leading: 1.2 },
        );
        left += pad;
        ops.push({ kind: 'line', x1: x, y1: left, x2: x + leftW, y2: left, color: p.rule });
      });
    }

    let right = top;
    const lists: [DishCardPart, string, string[]][] = [
      ['drinks', t('card.drinks'), card.dish.drinkPairings],
      ['cutlery', t('card.cutlery'), card.dish.cutlery],
    ];
    for (const [part, label, items] of lists) {
      if (!shows(part) || items.length === 0) continue;
      right = sectionHead(ops, label, rightX, right, rightW);
      for (const item of items) {
        right = block(ops, item, rightX, right + 0.6 * scale, rightW, 'regular', size, p.ink, {
          leading: 1.2,
        });
        right += 0.8 * scale;
      }
      right += 4.5 * scale;
    }

    if (shows('summary')) {
      right += 1.5 * scale;
      const chips: [string, 'filled' | 'outline' | 'vegan' | 'quiet', CardIcon | undefined][] = [];
      const whole = card.whole;
      for (const allergen of ordered(whole.contains)) {
        chips.push([cardAllergenName(t, allergen), 'filled', allergen]);
      }
      if (shows('mayContain')) {
        for (const allergen of ordered(whole.mayContain)) {
          chips.push([`(${cardAllergenName(t, allergen)})`, 'outline', allergen]);
        }
      }
      if (chips.length === 0) chips.push([t('card.noAllergens'), 'quiet', undefined]);
      if (shows('vegan')) {
        if (whole.vegan === 'yes') chips.push([t('card.vegan'), 'vegan', 'vegan']);
        else if (whole.vegan === 'unknown')
          chips.push([t('card.veganUnknown'), 'quiet', undefined]);
      }

      let cx = rightX;
      for (const [label, style, icon] of chips) {
        const probe = 2.6 + (icon ? 5.3 : 0) + width(label, 'semibold', 9.5) + 2.6;
        if (cx > rightX && cx + probe > rightX + rightW) {
          cx = rightX;
          right += 6.4 + 2;
        }
        cx += chip(ops, cx, right, label, style, icon) + 2;
      }
      right += 6.4;
    }

    return Math.max(left, right);
  }

  // --- the back ---------------------------------------------------------------------

  function back(): CardPage {
    const ops: Op[] = [];
    const x = MARGIN;
    const right = PAGE_W - MARGIN;
    const w = right - x;

    let y = eyebrow(ops, x, w);

    // "LUCHTIGE MAIS / ALLERGENEN" on one line, smaller for a long name.
    const name = upper(card.dish.name);
    const suffix = ` / ${upper(t('card.allergens'))}`;
    let size = 30;
    while (size > 16 && width(name + suffix, 'condSemibold', size) > w) size -= 1;
    const baseline = y + 1.5 + size * 0.7 * PT_TO_MM;
    const nameText =
      wrap(name, 'condSemibold', size, w - width(suffix, 'condSemibold', size))[0] ?? '';
    text(ops, nameText, x, baseline, 'condSemibold', size, p.ink);
    text(
      ops,
      suffix,
      x + width(nameText, 'condSemibold', size),
      baseline,
      'condSemibold',
      size,
      p.faint,
    );
    y = baseline + 6;

    const footTop = footer(ops, x, right, 2, 2);

    const allergens = DISH_CARD_ALLERGEN_ORDER;
    const vegan = shows('vegan');
    const mayContain = shows('mayContain');
    const nameW = 46;
    const columnsCount = allergens.length + (vegan ? 1 : 0);
    const colW = (w - nameW) / columnsCount;

    // Column heads: an icon, and the name underneath on up to three lines.
    const headLabels = [
      ...allergens.map((a) => cardAllergenName(t, a)),
      ...(vegan ? [t('card.vegan')] : []),
    ].map((label) => wrap(label, 'medium', 8, colW - 1.2).slice(0, 3));
    const headLines = Math.max(...headLabels.map((l) => l.length));
    const headH = 2.2 + 5.3 + 1.3 + headLines * lineMm(8, 1.1) + 1.6;

    ops.push({ kind: 'rect', x, y, w: nameW, h: headH, fill: p.head });
    text(
      ops,
      upper(t('card.component')),
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
    y += headH;

    // Rows, shortened when a dish has many components.
    const rows: (DishCardFacts & { name: string; quiet?: boolean })[] = [
      ...card.rows,
      ...(card.other ? [{ ...card.other, name: t('card.other'), quiet: true }] : []),
    ];
    const keyRoom = 18;
    const rowH = Math.max(
      6.5,
      Math.min(11, (footTop - 6 - keyRoom - y) / Math.max(rows.length, 1)),
    );
    const nameSize = rowH < 9 ? 9.5 : 10.5;
    const tableTop = y - headH;

    for (const row of rows) {
      const lines = wrap(row.name, row.quiet ? 'regular' : 'medium', nameSize, nameW - 5).slice(
        0,
        2,
      );
      const blockH = lines.length * lineMm(nameSize, 1.15);
      lines.forEach((line, n) =>
        text(
          ops,
          line,
          x + 2.5,
          y + (rowH - blockH) / 2 + ascentMm(nameSize) + n * lineMm(nameSize, 1.15),
          row.quiet ? 'regular' : 'medium',
          nameSize,
          row.quiet ? p.soft : p.ink,
        ),
      );

      allergens.forEach((allergen, i) => {
        const cx = x + nameW + i * colW;
        if (row.contains.includes(allergen)) {
          ops.push({ kind: 'rect', x: cx, y, w: colW, h: rowH, fill: p.accent });
          centred(ops, 'X', cx, y, colW, rowH, 'condSemibold', 13, p.onAccent);
        } else if (mayContain && row.mayContain.includes(allergen)) {
          centred(ops, '(X)', cx, y, colW, rowH, 'condSemibold', 11, p.accent);
        }
      });
      if (vegan) {
        const cx = x + nameW + allergens.length * colW;
        if (row.vegan === 'yes') {
          ops.push({
            kind: 'icon',
            icon: 'check',
            x: cx + (colW - 4.4) / 2,
            y: y + (rowH - 4.4) / 2,
            size: 4.4,
            color: p.vegan,
          });
        } else if (row.vegan === 'unknown') {
          centred(ops, '?', cx, y, colW, rowH, 'condSemibold', 12, p.faint);
        }
      }
      y += rowH;
    }

    // The grid over everything, so filled cells keep their edges.
    for (let row = 0; row <= rows.length; row++) {
      const ly = tableTop + headH + row * rowH;
      ops.push({ kind: 'line', x1: x, y1: ly, x2: right, y2: ly, color: p.rule });
    }
    for (let col = 0; col <= columnsCount; col++) {
      const lx = x + nameW + col * colW;
      ops.push({ kind: 'line', x1: lx, y1: tableTop, x2: lx, y2: y, color: p.rule });
    }
    ops.push({ kind: 'rect', x, y: tableTop, w, h: y - tableTop, stroke: p.line });

    // The key, then which cereal and which nut.
    y += 4.5;
    let kx = x;
    const keySize = 9;
    const keyItem = (draw: (at: number) => number, label: string) => {
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
    keyItem(swatch(true, 'X'), t('card.keyContains'));
    if (mayContain) keyItem(swatch(false, '(X)'), t('card.keyMayContain'));
    if (vegan) {
      keyItem((at) => {
        ops.push({ kind: 'icon', icon: 'check', x: at, y: y + 0.6, size: 4, color: p.vegan });
        return 4;
      }, t('card.keyVegan'));
      if (rows.some((row) => row.vegan === 'unknown')) {
        keyItem((at) => {
          centred(ops, '?', at, y, 4, 5.2, 'condSemibold', 11, p.faint);
          return 4;
        }, t('card.keyUnknown'));
      }
    }

    y += 5.2 + 3.5;
    const label = `${t('card.cerealsAndNuts')}:`;
    text(ops, label, x, y + ascentMm(9.5), 'semibold', 9.5, p.ink);
    const labelW = width(label, 'semibold', 9.5) + 1.6;
    block(ops, cerealsAndNuts(card.whole), x + labelW, y, w - labelW, 'regular', 9.5, p.soft);

    return { background: p.page, ops };
  }

  function centred(
    ops: Op[],
    value: string,
    x: number,
    y: number,
    w: number,
    h: number,
    font: CardFontKey,
    size: number,
    color: string,
  ) {
    const capHeight = size * 0.7 * PT_TO_MM;
    text(
      ops,
      value,
      x + (w - width(value, font, size)) / 2,
      y + (h + capHeight) / 2,
      font,
      size,
      color,
    );
  }

  function cerealsAndNuts(whole: DishCardFacts): string {
    const parts: string[] = [];
    if (whole.contains.includes('gluten') || whole.gluten.length > 0) {
      parts.push(t('card.cereals', { names: whole.gluten.join(', ') || t('card.unnamed') }));
    }
    if (whole.contains.includes('nuts') || whole.nuts.length > 0) {
      parts.push(t('card.nuts', { names: whole.nuts.join(', ') || t('card.unnamed') }));
    }
    return parts.length > 0 ? parts.join(' · ') : t('card.noCerealsOrNuts');
  }

  return [front(), back()];
}

function ordered(allergens: readonly Allergen[]): Allergen[] {
  return DISH_CARD_ALLERGEN_ORDER.filter((a) => allergens.includes(a));
}
