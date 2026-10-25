import { CSS_FONT, PT_TO_MM } from '../lib/dishcard/fonts.js';
import { CARD_ICONS } from '../lib/dishcard/icons.js';
import { HAIRLINE, PAGE_H, PAGE_W, type CardPage } from '../lib/dishcard/layout.js';

/**
 * One page of a dish card, drawn as SVG.
 *
 * The same drawing serves the preview and the printout: on screen it scales
 * to the column it sits in, and in print it is exactly A4 landscape. Kerning
 * is off because the layout measured every line without it.
 */
export function DishCardSheet({ page, label }: { page: CardPage; label: string }) {
  return (
    <svg
      viewBox={`0 0 ${PAGE_W} ${PAGE_H}`}
      role="img"
      aria-label={label}
      className="dish-card-page block h-auto w-full"
      style={{ fontKerning: 'none' }}
    >
      <rect width={PAGE_W} height={PAGE_H} fill={page.background} />
      {page.ops.map((op, index) => {
        switch (op.kind) {
          case 'rect':
            return (
              <rect
                key={index}
                x={op.x}
                y={op.y}
                width={op.w}
                height={op.h}
                fill={op.fill ?? 'none'}
                stroke={op.stroke}
                strokeWidth={op.stroke ? HAIRLINE : undefined}
              />
            );
          case 'line':
            return (
              <line
                key={index}
                x1={op.x1}
                y1={op.y1}
                x2={op.x2}
                y2={op.y2}
                stroke={op.color}
                strokeWidth={HAIRLINE}
              />
            );
          case 'text': {
            const size = op.size * PT_TO_MM;
            return (
              <text
                key={index}
                x={op.x}
                y={op.y}
                fill={op.color}
                fontFamily={`'${CSS_FONT[op.font].family}'`}
                fontWeight={CSS_FONT[op.font].weight}
                fontSize={size}
                letterSpacing={op.tracking ? op.tracking * size : undefined}
                style={{ whiteSpace: 'pre' }}
              >
                {op.text}
              </text>
            );
          }
          case 'icon':
            return (
              <path
                key={index}
                d={CARD_ICONS[op.icon]}
                transform={`translate(${op.x} ${op.y}) scale(${op.size / 24})`}
                fill="none"
                stroke={op.color}
                strokeWidth={1.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          case 'image':
            return (
              <image
                key={index}
                href={op.src}
                x={op.x}
                y={op.y}
                width={op.w}
                height={op.h}
                preserveAspectRatio={op.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}
              />
            );
        }
      })}
    </svg>
  );
}
