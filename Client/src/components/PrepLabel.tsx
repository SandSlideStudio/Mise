import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { labelMillimetres, type AllergenProfile, type LabelSize } from '@mise/contracts';
import { computeUseBy, keptFor, type KeptAs, type UseBy } from '@mise/domain';
import { useT, type MessageKey, type Translator } from '../i18n/index.js';

/**
 * The label on a container of prep: what it is, when it was made and by whom,
 * until when it may be used, how it is kept, and its allergens.
 *
 * It goes through the browser's print dialog to whatever label printer the
 * tablet has, on a page the size of one label with no margin. Label printers
 * are thermal and print black only, so it is black on white with no greys.
 * On the smallest rolls only what matters at the fridge door is left, in
 * larger type: the name, the use-by, made and by, and the allergens.
 */

/** Everything a label says, gathered before it is printed so it prints offline too. */
export interface LabelContent {
  name: string;
  made: Date;
  /** Who made it. Null: a line to write it on. */
  by: string | null;
  kitchenName: string;
  /**
   * What the recipe says about keeping it. Null for a line not made from a
   * recipe. `kept` is missing from a recipe saved offline by an older version.
   */
  recipe: { shelfLifeHours: number | null; kept?: KeptAs | null; storage: string | null } | null;
  /** Null when not known (no recipe, or it couldn't be worked out): a line to write them on. */
  allergens: AllergenProfile | null;
}

type Tier = 'small' | 'medium' | 'large';

/** Type sizes per tier, in points. A 25 mm label holds about five short lines of these. */
const TYPE: Record<Tier, { name: number; useBy: number; line: number; pad: number }> = {
  small: { name: 11, useBy: 12, line: 7.5, pad: 1.5 },
  medium: { name: 14, useBy: 15, line: 9, pad: 2.5 },
  large: { name: 20, useBy: 20, line: 12, pad: 4 },
};

/**
 * The small sizes are set for the shortest roll, 25 mm; a 29 or 32 mm roll
 * gets the same layout with the type grown to fill it, so the use-by reads
 * from further off.
 */
function typeFor(tier: Tier, height: number) {
  const base = TYPE[tier];
  if (tier !== 'small') return base;
  const grow = (points: number) => Math.round(((points * height) / 25) * 10) / 10;
  return { ...base, name: grow(base.name), useBy: grow(base.useBy), line: grow(base.line) };
}

function tierOf(size: LabelSize): Tier {
  const { height } = labelMillimetres(size);
  return height <= 32 ? 'small' : height <= 51 ? 'medium' : 'large';
}

/**
 * "Marco R." for Marco Rossi: enough to ask the right person, short enough
 * for the smallest label.
 */
export function shortName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = words[0]!.slice(0, 14);
  if (words.length === 1) return first;
  return `${first} ${Array.from(words[words.length - 1]!)[0]!.toLocaleUpperCase()}.`;
}

/** Until when this label's batch may be used. */
export function labelUseBy(label: LabelContent): { useBy: UseBy; kept: KeptAs | null } {
  if (!label.recipe) return { useBy: { kind: 'blank', reason: 'unknown' }, kept: null };
  // The chef's choice; for a recipe nobody has chosen for yet, what its note says.
  const kept = keptFor(label.recipe);
  return {
    useBy: computeUseBy({ made: label.made, shelfLifeHours: label.recipe.shelfLifeHours, kept }),
    kept,
  };
}

function day(locale: string, date: Date): string {
  return date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
}

function time(locale: string, date: Date): string {
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

const KEPT: Record<KeptAs, MessageKey> = {
  chilled_7: 'label.keptChilled7',
  chilled_4: 'label.keptChilled4',
  frozen: 'label.keptFrozen',
  ambient: 'label.keptAmbient',
  hot: 'label.keptHot',
};

/** How it is kept and where, as far as the recipe says: "Chilled ≤4 °C · Walk-in". */
function keptLine(t: Translator['t'], kept: KeptAs | null, label: LabelContent): string {
  const note = label.recipe?.storage?.trim() ?? '';
  if (!kept) return note;
  // Read from the note rather than chosen: the note would only say it again.
  if (!label.recipe?.kept || !note) return t(KEPT[kept]);
  return `${t(KEPT[kept])} · ${note}`;
}

/** A line to write on by hand, after its heading. */
function Blank() {
  return (
    <span aria-hidden className="ml-[1mm] min-w-[12mm] flex-1 border-b-[0.6pt] border-black" />
  );
}

function allergenLine(t: Translator['t'], allergens: AllergenProfile) {
  const short = (codes: string[]) =>
    codes.map((code) => t(`cardAllergen.${code}` as MessageKey)).join(', ');
  if (allergens.contains.length === 0 && allergens.mayContain.length === 0) {
    return <>{t('label.noAllergens')}</>;
  }
  return (
    <>
      {allergens.contains.length > 0 ? (
        <strong className="font-bold">
          {t('label.contains', { allergens: short(allergens.contains) })}
        </strong>
      ) : null}
      {allergens.contains.length > 0 && allergens.mayContain.length > 0 ? ' · ' : null}
      {allergens.mayContain.length > 0
        ? t('label.mayContain', { allergens: short(allergens.mayContain) })
        : null}
    </>
  );
}

/** One label, at its real size in millimetres. */
export function PrepLabel({ label, size }: { label: LabelContent; size: LabelSize }) {
  const { t, locale } = useT();
  const { width, height } = labelMillimetres(size);
  const tier = tierOf(size);
  const type = typeFor(tier, height);
  const { useBy: until, kept } = labelUseBy(label);
  const keptText = keptLine(t, kept, label);

  return (
    <article
      data-size={size}
      data-tier={tier}
      className="flex flex-col overflow-hidden bg-white leading-[1.15] text-black"
      style={{
        width: `${width}mm`,
        height: `${height}mm`,
        padding: `${type.pad}mm`,
        fontSize: `${type.line}pt`,
        gap: tier === 'small' ? '0.4mm' : '1mm',
      }}
    >
      <h2
        className="truncate font-bold"
        style={{ fontSize: `${type.name}pt`, lineHeight: 1.05, fontFamily: 'inherit' }}
      >
        {label.name}
      </h2>

      {/* The date is the one thing never cut short: the words before it give way first. */}
      <p className="flex items-baseline">
        <span className="mr-[1mm] min-w-0 truncate">{t('label.useBy')}</span>
        {until.kind === 'blank' ? (
          <Blank />
        ) : (
          <strong
            className="shrink-0 font-bold"
            style={{ fontSize: `${type.useBy}pt` }}
            data-testid="use-by"
          >
            {day(locale, until.at)}
            {until.withTime ? ` ${time(locale, until.at)}` : ''}
          </strong>
        )}
      </p>

      <p className="flex items-baseline gap-x-[1mm]">
        <span className="shrink-0">
          {t('label.made')} {day(locale, label.made)} {time(locale, label.made)}
        </span>
        <span className="ml-[1.5mm] shrink-0">{t('label.by')}</span>
        {label.by ? <span className="truncate font-bold">{shortName(label.by)}</span> : <Blank />}
      </p>

      {tier !== 'small' && keptText ? <p className="truncate">{keptText}</p> : null}

      {/* Two lines hold the usual handful of allergens even on the smallest roll. */}
      <p
        className={
          !label.allergens
            ? 'flex items-baseline'
            : tier === 'small'
              ? 'line-clamp-2'
              : 'line-clamp-4'
        }
      >
        {label.allergens ? (
          allergenLine(t, label.allergens)
        ) : (
          <>
            <span className="shrink-0">{t('label.allergens')}</span>
            <Blank />
          </>
        )}
      </p>

      {tier !== 'small' ? (
        <p className="mt-auto truncate" style={{ fontSize: `${Math.max(6, type.line - 2)}pt` }}>
          {label.kitchenName}
        </p>
      ) : null}
    </article>
  );
}

/**
 * What to tell the person printing about the use-by: that it is the default
 * and can be changed, or why there is none and that it has to be written on.
 * Null when the recipe's own shelf life is printed.
 */
export function useByNote(t: Translator['t'], label: LabelContent): string | null {
  const { useBy: until } = labelUseBy(label);
  if (until.kind === 'shelfLife') return null;
  if (until.kind === 'default') return t('label.noteDefault', { days: String(until.days) });
  if (!label.recipe) return t('label.noteNoRecipe');
  if (until.reason === 'frozen') return t('label.noteFrozen');
  if (until.reason === 'ambient') return t('label.noteAmbient');
  if (until.reason === 'hot') return t('label.noteHot');
  return t('label.noteUnknown');
}

/** A print run: the labels, one per page, and the roll they go on. */
export interface LabelJob {
  labels: LabelContent[];
  size: LabelSize;
}

/**
 * Prints labels alone, on pages the size of one label with no margin; the
 * rest of the app is hidden from the printer while they print. Draw
 * <LabelSheets> for the job while it is set.
 */
export function usePrintLabels(): [job: LabelJob | null, print: (job: LabelJob) => void] {
  const [job, setJob] = useState<LabelJob | null>(null);

  useEffect(() => {
    if (!job) return;
    const { width, height } = labelMillimetres(job.size);
    const root = document.documentElement;
    const style = document.createElement('style');
    style.textContent = `@page { size: ${width}mm ${height}mm; margin: 0; }`;
    document.head.append(style);
    root.classList.add('printing-label');
    const done = () => setJob(null);
    window.addEventListener('afterprint', done);
    // After the labels have been drawn.
    const timer = window.setTimeout(() => window.print(), 50);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', done);
      root.classList.remove('printing-label');
      style.remove();
    };
  }, [job]);

  return [job, setJob];
}

/** The labels as they go to the printer, one to a page. Drawn only while printing. */
export function LabelSheets({ job }: { job: LabelJob }) {
  return createPortal(
    <div className="print-label">
      {job.labels.map((label, index) => (
        <div key={index} className="print-label-page">
          <PrepLabel label={label} size={job.size} />
        </div>
      ))}
    </div>,
    document.body,
  );
}
