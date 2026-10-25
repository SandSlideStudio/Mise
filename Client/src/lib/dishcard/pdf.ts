import { PDFDocument, rgb, setCharacterSpacing, type PDFFont, type PDFImage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { measure, MM_TO_PT, runsFor, type CardFontKey, type CardFonts } from './fonts.js';
import { CARD_ICONS } from './icons.js';
import { HAIRLINE, PAGE_H, PAGE_W, type CardPage } from './layout.js';

/**
 * The same drawing as the preview, written into a PDF.
 *
 * Everything happens in the browser: the server is often a Raspberry Pi and
 * has better things to do, and the browser can already read every image
 * format Mise accepts and hand it over as one a PDF can hold.
 */

export interface PdfMeta {
  title: string;
  language: string;
}

function colour(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

const X = (mm: number) => mm * MM_TO_PT;
/** PDF measures from the bottom of the page; the layout from the top. */
const Y = (mm: number) => (PAGE_H - mm) * MM_TO_PT;

/** A photo or logo, cropped and sized the way the layout wants it, as bytes a PDF takes. */
async function prepareImage(
  src: string,
  box: { w: number; h: number },
  fit: 'cover' | 'contain',
): Promise<{ bytes: Uint8Array; png: boolean; w: number; h: number }> {
  const response = await fetch(src, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Could not load ${src}`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  // Enough pixels for a sharp print at A4 size, and no more.
  const longest = 1800;
  let sx = 0;
  let sy = 0;
  let sw = bitmap.width;
  let sh = bitmap.height;
  if (fit === 'cover') {
    const target = box.w / box.h;
    if (sw / sh > target) {
      sw = sh * target;
      sx = (bitmap.width - sw) / 2;
    } else {
      sh = sw / target;
      sy = (bitmap.height - sh) / 2;
    }
  }
  const scale = Math.min(1, longest / Math.max(sw, sh));
  const outW = Math.max(1, Math.round(sw * scale));
  const outH = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);
  bitmap.close();

  // A logo may be see-through, so it stays PNG; a photograph goes as JPEG.
  const png = fit === 'contain';
  const out = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('Could not encode the image'))),
      png ? 'image/png' : 'image/jpeg',
      0.9,
    ),
  );
  return { bytes: new Uint8Array(await out.arrayBuffer()), png, w: outW, h: outH };
}

export async function renderDishCardPdf(
  pages: CardPage[],
  fonts: CardFonts,
  meta: PdfMeta,
): Promise<Blob> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(meta.title);
  doc.setLanguage(meta.language);
  doc.setCreator('Mise');
  doc.setProducer('Mise');

  const embedded = new Map<string, Promise<PDFFont>>();
  const fontFor = (key: CardFontKey, face: 0 | 1) => {
    const id = `${key}:${face}`;
    if (!embedded.has(id))
      embedded.set(id, doc.embedFont(fonts[key][face].bytes, { subset: true }));
    return embedded.get(id)!;
  };

  const images = new Map<string, Promise<{ image: PDFImage; w: number; h: number }>>();
  const imageFor = (src: string, box: { w: number; h: number }, fit: 'cover' | 'contain') => {
    const id = `${src}:${fit}:${box.w}x${box.h}`;
    if (!images.has(id)) {
      images.set(
        id,
        prepareImage(src, box, fit).then(async (prepared) => ({
          image: prepared.png
            ? await doc.embedPng(prepared.bytes)
            : await doc.embedJpg(prepared.bytes),
          w: prepared.w,
          h: prepared.h,
        })),
      );
    }
    return images.get(id)!;
  };

  for (const layout of pages) {
    const page = doc.addPage([X(PAGE_W), X(PAGE_H)]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: X(PAGE_W),
      height: X(PAGE_H),
      color: colour(layout.background),
    });

    for (const op of layout.ops) {
      switch (op.kind) {
        case 'rect':
          page.drawRectangle({
            x: X(op.x),
            y: Y(op.y + op.h),
            width: X(op.w),
            height: X(op.h),
            color: op.fill ? colour(op.fill) : undefined,
            borderColor: op.stroke ? colour(op.stroke) : undefined,
            borderWidth: op.stroke ? X(HAIRLINE) : 0,
          });
          break;
        case 'line':
          page.drawLine({
            start: { x: X(op.x1), y: Y(op.y1) },
            end: { x: X(op.x2), y: Y(op.y2) },
            thickness: X(HAIRLINE),
            color: colour(op.color),
          });
          break;
        case 'text': {
          const spacing = (op.tracking ?? 0) * op.size;
          if (spacing) page.pushOperators(setCharacterSpacing(spacing));
          let x = op.x;
          for (const run of runsFor(fonts, op.font, op.text)) {
            page.drawText(run.text, {
              x: X(x),
              y: Y(op.y),
              size: op.size,
              font: await fontFor(op.font, run.face),
              color: colour(op.color),
            });
            x += measure(fonts, op.font, run.text, op.size, op.tracking);
          }
          if (spacing) page.pushOperators(setCharacterSpacing(0));
          break;
        }
        case 'icon':
          page.drawSvgPath(CARD_ICONS[op.icon], {
            x: X(op.x),
            y: Y(op.y),
            scale: X(op.size) / 24,
            borderColor: colour(op.color),
            borderWidth: 1.4,
            borderLineCap: 1,
          });
          break;
        case 'image': {
          const { image, w, h } = await imageFor(op.src, op, op.fit);
          let dw = op.w;
          let dh = op.h;
          if (op.fit === 'contain') {
            const scale = Math.min(op.w / w, op.h / h);
            dw = w * scale;
            dh = h * scale;
          }
          const dx = op.x + (op.w - dw) / 2;
          const dy = op.y + (op.h - dh) / 2;
          page.drawImage(image, { x: X(dx), y: Y(dy + dh), width: X(dw), height: X(dh) });
          break;
        }
      }
    }
  }

  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
