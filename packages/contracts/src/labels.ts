import { z } from 'zod';

/**
 * The labels a kitchen sticks on its containers of prep, printed through the
 * browser to whatever label printer the tablet has. These are the common
 * rolls; each is named width × height in millimetres, as it reads.
 */
export const LABEL_SIZES = ['62x29', '62x100', '54x25', '57x32', '89x36', '102x51'] as const;
export type LabelSize = (typeof LABEL_SIZES)[number];
export const labelSizeSchema = z.enum(LABEL_SIZES);

/** The smallest roll that fits every Brother QL, so the one most kitchens already have. */
export const DEFAULT_LABEL_SIZE: LabelSize = '62x29';

/** Width and height in millimetres. */
export function labelMillimetres(size: LabelSize): { width: number; height: number } {
  const [width, height] = size.split('x').map(Number) as [number, number];
  return { width, height };
}

/** The kitchen's choice of label, which every tablet needs to print one, offline too. */
export const labelSettingsSchema = z.object({
  size: labelSizeSchema,
  /** Open the print dialog by itself when a line from a recipe is ticked. */
  onTick: z.boolean(),
});

export type LabelSettings = z.infer<typeof labelSettingsSchema>;
