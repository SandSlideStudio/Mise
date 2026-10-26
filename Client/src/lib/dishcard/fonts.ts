import fontkit from '@pdf-lib/fontkit';
import type { Font } from 'pdf-lib/cjs/types/fontkit.js';
// WOFF rather than WOFF2: the PDF library can only cut a subset out of these.
import barlow400 from '@fontsource/barlow/files/barlow-latin-400-normal.woff?url';
import barlow400ext from '@fontsource/barlow/files/barlow-latin-ext-400-normal.woff?url';
import barlow500 from '@fontsource/barlow/files/barlow-latin-500-normal.woff?url';
import barlow500ext from '@fontsource/barlow/files/barlow-latin-ext-500-normal.woff?url';
import barlow600 from '@fontsource/barlow/files/barlow-latin-600-normal.woff?url';
import barlow600ext from '@fontsource/barlow/files/barlow-latin-ext-600-normal.woff?url';
import condensed500 from '@fontsource/barlow-condensed/files/barlow-condensed-latin-500-normal.woff?url';
import condensed500ext from '@fontsource/barlow-condensed/files/barlow-condensed-latin-ext-500-normal.woff?url';
import condensed600 from '@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff?url';
import condensed600ext from '@fontsource/barlow-condensed/files/barlow-condensed-latin-ext-600-normal.woff?url';

/**
 * The type on a dish card: the same Barlow the app draws with, so the card
 * on screen, on paper and in the PDF is set in one face and measures alike.
 *
 * Each style comes as two files, the Latin one and the extended Latin one
 * for letters such as ł and ő, and a run of text uses whichever has the
 * glyph. Loaded only when a card is opened.
 */

export type CardFontKey = 'regular' | 'medium' | 'semibold' | 'condMedium' | 'condSemibold';

/** How a style is named to the browser, for drawing on screen and in print. */
export const CSS_FONT: Record<CardFontKey, { family: string; weight: number }> = {
  regular: { family: 'Barlow', weight: 400 },
  medium: { family: 'Barlow', weight: 500 },
  semibold: { family: 'Barlow', weight: 600 },
  condMedium: { family: 'Barlow Condensed', weight: 500 },
  condSemibold: { family: 'Barlow Condensed', weight: 600 },
};

const FILES: Record<CardFontKey, [latin: string, extended: string]> = {
  regular: [barlow400, barlow400ext],
  medium: [barlow500, barlow500ext],
  semibold: [barlow600, barlow600ext],
  condMedium: [condensed500, condensed500ext],
  condSemibold: [condensed600, condensed600ext],
};

export interface CardFace {
  bytes: Uint8Array;
  font: Font;
}

export type CardFonts = Record<CardFontKey, [CardFace, CardFace]>;

let loading: Promise<CardFonts> | null = null;

async function face(url: string): Promise<CardFace> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { bytes, font: fontkit.create(bytes) as unknown as Font };
}

export function loadCardFonts(): Promise<CardFonts> {
  loading ??= (async () => {
    const entries = await Promise.all(
      (Object.keys(FILES) as CardFontKey[]).map(
        async (key) => [key, await Promise.all(FILES[key].map(face))] as const,
      ),
    );
    return Object.fromEntries(entries) as CardFonts;
  })().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** A piece of text set in one file of a style. */
export interface Run {
  text: string;
  face: 0 | 1;
}

/** Split text by which file has each letter. Latin first; anything neither has stays Latin. */
export function runsFor(fonts: CardFonts, key: CardFontKey, text: string): Run[] {
  const [latin, extended] = fonts[key];
  const runs: Run[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    const which: 0 | 1 =
      !latin.font.hasGlyphForCodePoint(code) && extended.font.hasGlyphForCodePoint(code) ? 1 : 0;
    const last = runs[runs.length - 1];
    if (last && last.face === which) last.text += char;
    else runs.push({ text: char, face: which });
  }
  return runs;
}

/**
 * Width in millimetres at a size in points. No kerning, on purpose: the PDF is
 * drawn without it, and the screen is told to leave it off too, so every line
 * breaks in the same place everywhere.
 */
export function measure(
  fonts: CardFonts,
  key: CardFontKey,
  text: string,
  sizePt: number,
  trackingEm = 0,
): number {
  let units = 0;
  for (const run of runsFor(fonts, key, text)) {
    const font = fonts[key][run.face].font;
    for (const char of run.text) {
      units += font.glyphForCodePoint(char.codePointAt(0)!).advanceWidth / font.unitsPerEm;
    }
  }
  const chars = [...text].length;
  const points = units * sizePt + trackingEm * sizePt * chars;
  return points * PT_TO_MM;
}

export const PT_TO_MM = 25.4 / 72;
export const MM_TO_PT = 72 / 25.4;
