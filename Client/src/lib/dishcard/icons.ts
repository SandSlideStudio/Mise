import type { Allergen } from '@mise/domain';

/**
 * The allergen icons on a dish card, drawn for Mise.
 *
 * Plain stroked paths on a 24-unit grid, nothing else, because the same data
 * has to draw on screen, in print and inside a PDF. Each one reads in black
 * and white, since a card spends its life on a photocopier.
 */

function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
}

function ellipse(cx: number, cy: number, rx: number, ry: number, degrees = 0): string {
  const a = (degrees * Math.PI) / 180;
  const dx = rx * Math.cos(a);
  const dy = rx * Math.sin(a);
  const start = `${cx - dx} ${cy - dy}`;
  const end = `${cx + dx} ${cy + dy}`;
  return `M${start}A${rx} ${ry} ${degrees} 1 0 ${end}A${rx} ${ry} ${degrees} 1 0 ${start}`;
}

export type CardIcon = Allergen | 'vegan' | 'check';

export const CARD_ICONS: Record<CardIcon, string> = {
  eggs: ellipse(12, 13, 5.5, 7.5),
  gluten:
    'M12 21V4M12 9c-3 0-4-2-4-4 3 0 4 2 4 4zM12 9c3 0 4-2 4-4-3 0-4 2-4 4zM12 13c-3 0-4-2-4-4 3 0 4 2 4 4zM12 13c3 0 4-2 4-4-3 0-4 2-4 4zM12 17c-3 0-4-2-4-4 3 0 4 2 4 4zM12 17c3 0 4-2 4-4-3 0-4 2-4 4z',
  lupin: [
    'M12 21V10',
    circle(12, 4.5, 1.4),
    circle(10, 7.5, 1.4),
    circle(14, 7.5, 1.4),
    circle(9.5, 11, 1.4),
    circle(14.5, 11, 1.4),
    'M12 17c-2-.5-3.5-2-4-4M12 17c2-.5 3.5-2 4-4',
  ].join(''),
  milk: 'M9.5 3h5v3l2.5 3.5V21H7V9.5L9.5 6zM7 13h10',
  mustard:
    'M10.5 2.5h3l1 3.5h-5zM9.5 6h5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 8 19.5v-12A1.5 1.5 0 0 1 9.5 6zM10 12h4',
  sulphites: 'M7.5 3h9c0 5.5-2 8.5-4.5 8.5S7.5 8.5 7.5 3zM12 11.5V19M8.5 21h7M8 6.5h8',
  molluscs: `M3 18.5h17${circle(13, 12, 5)}M13 12a2 2 0 1 0 2-2M8 17c-2 0-3-1.5-3-3.5`,
  fish: `M3 12c3.5-5.5 10-6 14.5 0-4.5 6-11 5.5-14.5 0zM17.5 12 21 8.5v7z${circle(7.5, 11, 0.6)}`,
  soybeans: [
    'M5 18.5C6.5 10 11.5 5.5 19 5c-.5 7.5-5.5 13-14 13.5z',
    circle(9.5, 14.5, 1.6),
    circle(12.5, 11.5, 1.6),
    circle(15.5, 8.5, 1.6),
  ].join(''),
  sesame: [
    ellipse(8, 8, 2.6, 1.6, 65),
    ellipse(15, 7, 2.6, 1.6, 110),
    ellipse(12, 13, 2.6, 1.6, 90),
    ellipse(7.5, 16.5, 2.6, 1.6, 120),
    ellipse(16, 16, 2.6, 1.6, 60),
  ].join(''),
  celery: [
    'M9 21V11M12 21V9M15 21V11',
    circle(9, 8, 2.2),
    circle(12, 5.5, 2.2),
    circle(15, 8, 2.2),
  ].join(''),
  crustaceans:
    'M6 7c5-4 13-1 12.5 6-.3 4.5-4.5 7-9 6M9.5 19 7 21.5M9.5 19 6.5 17.5M9 8.5c2 1.5 3 4 2.5 7M12.5 7.5c1.5 2 2 4.5 1.5 7.5M15.5 8.5c1 2 1 4 .3 6M6 7 3 5.5M6 7 4 9.5',
  peanuts:
    'M12 3c2.8 0 4.5 2 4.5 4.5 0 1.6-1.2 2.6-1.2 4.5s1.2 2.9 1.2 4.5c0 2.6-2 4.5-4.5 4.5s-4.5-1.9-4.5-4.5c0-1.6 1.2-2.6 1.2-4.5S7.5 9.1 7.5 7.5C7.5 5 9.2 3 12 3z',
  nuts: 'M5.5 10.5c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5zM12 5V2.8M7 10.5c0 6 2.4 10 5 10s5-4 5-10',
  vegan: 'M5 19C5 10 11 5 19.5 4.5 19.5 13 14 19 5 19zM5 19l8.5-8.5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
};
