import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import type { ExpandedLine, Recipe, RecipePhoto } from '@mise/contracts';
import { convert, formatQuantity, humanize, isUnitCode, type Allergen } from '@mise/domain';
import { useDishCardSettings } from '../api/dishcards.js';
import { useStations } from '../api/kitchen.js';
import { useCurrentUser } from '../api/session.js';
import {
  useDeletePhoto,
  useDeleteRecipe,
  useDuplicateRecipe,
  useExpandedRecipe,
  useRecipeUsedBy,
  useUploadPhoto,
  type ScaleTarget,
} from '../api/recipes.js';
import { AppShell } from '../components/AppShell.js';
import { Plate } from '../components/Plate.js';
import {
  allergenName,
  clockTime,
  errorMessage,
  inSentence,
  recipeStatusName,
  recipeTypeName,
  useT,
} from '../i18n/index.js';

/**
 * Reading a spec, at whatever size is being cooked tonight — on the pass, at a
 * desk, or on a phone in a cook's apron.
 *
 * Allergens sit above the ingredients in reversed ink, the one thing on the
 * page that cannot be missed or mistaken for decoration. The size control is
 * the point of the screen: a chef asks "make me twenty-five", "I need five
 * litres" or "two batches", and all three go through the same domain code the
 * prep list uses, so a scaled spec and a prep list can never disagree.
 */
export function RecipeView() {
  const { recipeId } = useParams({ from: '/recipes/$recipeId' });
  const { amount, unit } = useSearch({ from: '/recipes/$recipeId' });
  const asked: ScaleTarget =
    amount !== undefined && unit !== undefined && isUnitCode(unit)
      ? { yieldValue: amount, yieldUnit: unit }
      : {};
  return <RecipePage key={recipeId} recipeId={recipeId} asked={asked} />;
}

function RecipePage({ recipeId, asked }: { recipeId: string; asked: ScaleTarget }) {
  const translator = useT();
  const { t, plural } = translator;
  const navigate = useNavigate();
  const { data: user } = useCurrentUser();
  const stations = useStations();
  const [target, setTarget] = useState<ScaleTarget>(asked);
  const expanded = useExpandedRecipe(recipeId, target);
  const usedBy = useRecipeUsedBy(recipeId);
  const duplicate = useDuplicateRecipe();
  const remove = useDeleteRecipe();
  const [confirming, setConfirming] = useState(false);
  const cardSettings = useDishCardSettings();

  // An amount this recipe can't be scaled to, such as kilos of something
  // counted in pieces, opens the spec as written instead of an error.
  const unscalable = expanded.isError && target === asked && asked.yieldValue !== undefined;
  useEffect(() => {
    if (unscalable) setTarget({});
  }, [unscalable]);

  if (!user) return null;
  const canManage = user.role !== 'cook';

  if (expanded.isPending) {
    return (
      <AppShell>
        <main className="text-ink-soft mx-auto max-w-[880px] px-5 py-10">
          {t('common.loading')}
        </main>
      </AppShell>
    );
  }

  if (expanded.isError || !expanded.data) {
    return (
      <AppShell>
        <main className="mx-auto max-w-[880px] px-5 py-10">
          <p className="text-danger">{errorMessage(translator, expanded.error)}</p>
          <Link to="/recipes" className="btn-quiet mt-5">
            {t('recipe.backToBook')}
          </Link>
        </main>
      </AppShell>
    );
  }

  const { recipe, factor, lines, allergens } = expanded.data;
  const station = stations.data?.find((s) => s.id === recipe.stationId);
  const scaled = Math.abs(factor - 1) > 0.001;
  const portions = recipe.portions ? round(recipe.portions * factor) : null;
  const size: Size = {
    note: scaled ? t('recipe.scaled', { factor: round(factor) }) : t('recipe.asWritten'),
    makes: `${t('recipe.makes', { amount: amount(recipe.yield.value * factor, recipe.yield.unit) })}${
      portions ? ` · ${plural('recipes.portions', portions)}` : ''
    }`,
  };
  const contains = (allergens.contains as Allergen[]).map((a) => allergenName(t, a));
  const mayContain = (allergens.mayContain as Allergen[]).map((a) => allergenName(t, a));

  return (
    <AppShell>
      <main className="mx-auto max-w-[880px] px-0 py-4 sm:px-6 sm:py-8">
        <Link
          to="/recipes"
          className="no-print eyebrow hover:text-ink mb-3 ml-4 inline-block sm:mb-4 sm:ml-0"
        >
          {t('recipe.back')}
        </Link>

        <Plate className="border-x-0 print:hidden sm:border-x">
          <header className="bg-surface-raised border-line border-b px-4 pt-5 pb-4 sm:px-8 sm:pt-7 sm:pb-5">
            <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-2">
              <h1 className="text-[36px] leading-[0.98] sm:text-[56px]">{recipe.name}</h1>
              <span className="tag tag-brand text-[13px]">{recipeTypeName(t, recipe.type)}</span>
              {station ? <span className="tag text-[13px]">{station.name}</span> : null}
              {recipe.status !== 'published' ? (
                <span className="tag tag-accent text-[13px]">
                  {recipeStatusName(t, recipe.status)}
                </span>
              ) : null}
            </div>
            <p className="text-ink-soft mt-2 flex flex-wrap items-baseline gap-x-[18px] gap-y-1 text-base sm:text-[17px]">
              {[
                size.makes,
                recipe.prepMinutes ? t('recipe.minutes', { count: recipe.prepMinutes }) : null,
                recipe.shelfLifeHours ? plural('recipe.keeps', recipe.shelfLifeHours) : null,
              ]
                .filter((part): part is string => Boolean(part))
                .map((part) => (
                  <span key={part} className="after:ml-[18px] after:content-['·']">
                    {part}
                  </span>
                ))}
              <span className="font-display text-accent text-lg font-semibold tracking-[0.06em] uppercase sm:text-[21px]">
                {size.note}
              </span>
            </p>
          </header>

          <div className="bg-ink text-surface flex flex-col sm:flex-row sm:items-stretch">
            <div className="border-surface/20 flex items-center border-b px-4 pt-3 pb-2 sm:border-r sm:border-b-0 sm:px-5 sm:py-4">
              <span className="font-display text-[17px] font-semibold tracking-[0.16em] uppercase sm:text-[19px]">
                {t('recipe.contains')}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-1 px-4 py-3 sm:px-5 sm:py-3.5">
              <span className="font-display text-[24px] leading-[1.05] font-semibold tracking-[0.02em] sm:text-[30px]">
                {contains.length > 0 ? contains.join(', ') : t('recipe.nothingDeclarable')}
              </span>
              <span className="text-surface/70 text-[15px]">
                {mayContain.length > 0
                  ? `${t('recipe.mayContain', {
                      allergens: mayContain.map((name) => inSentence(translator, name)).join(', '),
                    })} `
                  : ''}
                {t('recipe.workedOut')}
              </span>
            </div>
          </div>

          <ScaleControl recipe={recipe} asked={asked} onChange={setTarget} />

          {lines.length === 0 ? (
            <p className="text-ink-soft bg-surface-raised p-8 text-center">{t('recipe.empty')}</p>
          ) : (
            <Tree lines={lines} />
          )}

          <Plating photos={recipe.photos} recipeId={recipe.id} canManage={canManage} />

          {recipe.method.length > 0 || recipe.storage ? (
            <section className="border-line bg-surface-raised border-t px-4 py-5 sm:px-8 sm:py-6">
              {recipe.method.length > 0 ? (
                <>
                  <h2 className="heading-rule mb-3.5 text-[22px]">{t('recipe.method')}</h2>
                  <ol className="flex flex-col gap-3">
                    {recipe.method.map((step, index) => (
                      <li
                        key={index}
                        className="grid grid-cols-[26px_1fr] items-baseline gap-3 sm:grid-cols-[34px_1fr] sm:gap-3.5"
                      >
                        <span className="font-display text-ink-faint text-right text-2xl font-semibold">
                          {index + 1}
                        </span>
                        <span className="text-lg leading-[1.45] text-pretty">{step.text}</span>
                      </li>
                    ))}
                  </ol>
                </>
              ) : null}
              {recipe.storage ? (
                <p className="text-ink-soft mt-5 text-[15px]">
                  <span className="eyebrow mr-2">{t('recipe.storage')}</span>
                  {recipe.storage}
                </p>
              ) : null}
            </section>
          ) : null}

          <div className="no-print border-line bg-surface-raised flex flex-wrap gap-2.5 border-t px-4 py-4 sm:px-8 sm:py-5">
            {canManage ? (
              <Link
                to="/recipes/$recipeId/edit"
                params={{ recipeId: recipe.id }}
                className="btn-primary grow sm:grow-0"
              >
                {t('common.edit')}
              </Link>
            ) : null}
            <button
              type="button"
              className="btn-quiet grow sm:grow-0"
              onClick={() => window.print()}
            >
              {t('recipe.print')}
            </button>
            {recipe.type === 'dish' && (canManage || cardSettings.data?.access === 'everyone') ? (
              <Link
                to="/recipes/$recipeId/card"
                params={{ recipeId: recipe.id }}
                className="btn-quiet grow sm:grow-0"
              >
                {t('recipe.dishCard')}
              </Link>
            ) : null}
            {canManage ? (
              <>
                <button
                  type="button"
                  className="btn-quiet grow sm:grow-0"
                  disabled={duplicate.isPending}
                  onClick={() =>
                    duplicate.mutate(
                      { id: recipe.id, name: t('recipe.copyName', { name: recipe.name }) },
                      {
                        onSuccess: (copy) =>
                          void navigate({
                            to: '/recipes/$recipeId/edit',
                            params: { recipeId: copy.id },
                          }),
                      },
                    )
                  }
                >
                  {t('recipe.duplicate')}
                </button>
                <button
                  type="button"
                  className="btn-danger grow sm:grow-0"
                  disabled={remove.isPending}
                  onClick={() =>
                    confirming
                      ? remove.mutate(recipe.id, {
                          onSuccess: () => void navigate({ to: '/recipes' }),
                        })
                      : setConfirming(true)
                  }
                >
                  {confirming ? t('common.reallyDelete') : t('common.delete')}
                </button>
              </>
            ) : null}
            {remove.error ? (
              <p role="alert" className="text-danger basis-full text-sm">
                {errorMessage(translator, remove.error)}
              </p>
            ) : null}
          </div>
        </Plate>

        {(usedBy.data ?? []).length > 0 ? (
          <section className="no-print mt-6 px-4 sm:px-0">
            <p className="eyebrow mb-2">{t('recipe.usedBy')}</p>
            <div className="flex flex-wrap gap-2">
              {usedBy.data?.map((parent) => (
                <Link
                  key={parent.id}
                  to="/recipes/$recipeId"
                  params={{ recipeId: parent.id }}
                  className="tag hover:text-ink hover:border-ink text-[13px]"
                >
                  {parent.name}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <PrintSheet
          recipe={recipe}
          stationName={station?.name ?? null}
          kitchenName={user.kitchenName}
          size={size}
          lines={lines}
          contains={contains}
          mayContain={mayContain}
        />
      </main>
    </AppShell>
  );
}

interface Size {
  /** "As written" or "2.5× the written recipe". */
  note: string;
  /** "Makes 1.25 l · 25 portions". */
  makes: string;
}

type ScaleMode = 'written' | 'portions' | 'yield' | 'batches';

/**
 * Ask for a size. Three fields, one per way a chef asks; typing in one is
 * choosing it.
 */
function ScaleControl({
  recipe,
  asked,
  onChange,
}: {
  recipe: Recipe;
  /** A size the page was opened at, such as a prep line's amount. */
  asked: ScaleTarget;
  onChange: (target: ScaleTarget) => void;
}) {
  const { t } = useT();
  // Shown in the unit the recipe is written in: 2000 g asked of a recipe in kg reads 2.
  const askedYield =
    asked.yieldValue !== undefined && asked.yieldUnit && isUnitCode(asked.yieldUnit)
      ? convert({ value: asked.yieldValue, unit: asked.yieldUnit }, recipe.yield.unit)
      : null;
  const [mode, setMode] = useState<ScaleMode>(askedYield ? 'yield' : 'written');
  const [values, setValues] = useState({
    portions: '',
    yield: askedYield?.ok ? String(Number(askedYield.value.value.toFixed(3))) : '',
    batches: '',
  });

  function apply(nextMode: ScaleMode, raw: string) {
    setMode(nextMode);
    if (nextMode !== 'written') setValues((current) => ({ ...current, [nextMode]: raw }));
    const value = Number(raw);
    if (nextMode === 'written' || !raw || !Number.isFinite(value) || value <= 0) {
      onChange({});
      return;
    }
    if (nextMode === 'portions') onChange({ portions: value });
    else if (nextMode === 'batches') onChange({ factor: value });
    else onChange({ yieldValue: value, yieldUnit: recipe.yield.unit });
  }

  function field(
    key: Exclude<ScaleMode, 'written'>,
    label: string,
    placeholder: string,
    unit?: string,
  ) {
    const active = mode === key;
    return (
      <span className="flex items-center gap-2.5">
        <button
          type="button"
          aria-pressed={active}
          onClick={() => apply(key, values[key])}
          className={`font-display h-[52px] min-w-[112px] border px-4 text-xl font-semibold tracking-[0.08em] uppercase sm:min-w-0 sm:px-5 ${
            active
              ? 'border-accent bg-accent text-accent-ink'
              : 'border-line bg-surface-raised text-ink hover:bg-surface'
          }`}
        >
          {label}
        </button>
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min={0}
          aria-label={label}
          value={values[key]}
          placeholder={placeholder}
          onChange={(e) => apply(key, e.target.value)}
          className="qty border-line bg-surface-raised placeholder:text-ink-faint focus-visible:border-accent h-[52px] w-[92px] border text-center text-[26px] [appearance:textfield] focus-visible:outline-2 focus-visible:-outline-offset-1 [&::-webkit-inner-spin-button]:appearance-none"
        />
        {unit ? <span className="text-ink-soft text-[17px]">{unit}</span> : null}
      </span>
    );
  }

  const divider = <span className="bg-field mx-1.5 hidden h-10 w-px sm:block" aria-hidden />;

  return (
    <div className="no-print bg-surface-sunk border-line border-b px-4 py-4 sm:px-8 sm:py-5">
      <p className="eyebrow mb-2.5">{t('scale.ask')}</p>
      <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
        {recipe.portions ? (
          <>
            {field('portions', t('scale.portions'), String(recipe.portions))}
            {divider}
          </>
        ) : null}
        {field('yield', t('scale.need'), String(recipe.yield.value), recipe.yield.unit)}
        {divider}
        {field('batches', t('scale.batches'), '1')}
        <button
          type="button"
          onClick={() => {
            setValues({ portions: '', yield: '', batches: '' });
            apply('written', '');
          }}
          className="btn-quiet text-ink-soft h-[52px] bg-transparent px-4 sm:ml-auto"
        >
          {t('recipe.asWritten')}
        </button>
      </div>
    </div>
  );
}

/**
 * How far one level steps in. Narrower on a phone, where four levels of
 * 26 pixels would leave the name no room at all.
 */
const INDENT_VARS = '[--indent:14px] sm:[--indent:26px]';

function indentStyle(depth: number): CSSProperties {
  return { paddingLeft: `calc(var(--indent) * ${depth})` };
}

/**
 * The whole tree, flattened. Depth is drawn with a leader line and repeated as
 * a number in the gutter, so the fourth level still reads on a photocopy.
 */
function Tree({ lines }: { lines: ExpandedLine[] }) {
  const { t } = useT();
  let lastSection: string | null | undefined;
  const columns =
    'grid grid-cols-[18px_76px_minmax(0,1fr)] gap-2.5 px-4 sm:grid-cols-[30px_120px_minmax(0,1fr)] sm:gap-3.5 sm:px-8';

  return (
    <div className={`bg-surface-raised ${INDENT_VARS}`}>
      <div className={`col-head py-2.5 ${columns}`}>
        <span>{t('recipe.level')}</span>
        <span className="text-right">{t('common.amount')}</span>
        <span>{t('recipe.what')}</span>
      </div>

      {lines.map((line, index) => {
        const startsSection = line.depth === 0 && line.section !== lastSection;
        if (line.depth === 0) lastSection = line.section;

        return (
          <div key={`${line.sourceId}-${index}`}>
            {startsSection && line.section ? (
              <p className="heading-rule px-4 pt-4 pb-1.5 text-lg sm:px-8">{line.section}</p>
            ) : null}
            <div className={`border-rule items-baseline border-b py-[11px] ${columns}`}>
              <span className="text-ink-faint font-mono text-[11px]">{line.depth}</span>
              <span className="qty text-right text-[20px] sm:text-[26px]">
                {amount(line.quantity.value, line.quantity.unit)}
              </span>
              <span className="relative min-w-0" style={indentStyle(line.depth)}>
                <Leaders depth={line.depth} />
                <span
                  className={
                    line.depth === 0
                      ? 'text-lg font-medium sm:text-xl'
                      : 'text-ink-soft text-base sm:text-lg'
                  }
                >
                  {line.name}
                </span>
                {line.kind === 'recipe' ? (
                  <Link
                    to="/recipes/$recipeId"
                    params={{ recipeId: line.sourceId }}
                    className="no-print text-accent ml-2.5 text-sm underline underline-offset-[3px]"
                  >
                    {t('recipe.open')}
                  </Link>
                ) : null}
                {line.note ? (
                  <span className="text-ink-soft mt-0.5 block text-[15px]">{line.note}</span>
                ) : null}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** An elbow into this level, and a guide down through every level above it. */
function Leaders({ depth, print = false }: { depth: number; print?: boolean }) {
  if (depth === 0) return null;
  const guide = print ? 'bg-[#c8c8c8]' : 'bg-rule';
  const elbow = print ? 'border-[#555]' : 'border-ink-faint';
  return (
    <>
      {Array.from({ length: depth - 1 }, (_, level) => (
        <span
          key={level}
          aria-hidden
          className={`absolute -top-[11px] -bottom-[11px] w-px ${guide}`}
          style={{ left: `calc(var(--indent) * ${level} + 6px)` }}
        />
      ))}
      <span
        aria-hidden
        className={`absolute -top-[11px] h-5 w-2.5 border-b border-l sm:w-3.5 ${elbow}`}
        style={{ left: `calc(var(--indent) * ${depth - 1} + 6px)` }}
      />
    </>
  );
}

/** In a fine dining kitchen the photograph is the spec, so it gets the room. */
function Plating({
  photos,
  recipeId,
  canManage,
}: {
  photos: RecipePhoto[];
  recipeId: string;
  canManage: boolean;
}) {
  const translator = useT();
  const { t } = translator;
  const upload = useUploadPhoto(recipeId);
  const remove = useDeletePhoto(recipeId);
  // Deleting a photo takes two taps, like everything else that can't be undone.
  const [confirmingPhoto, setConfirmingPhoto] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  if (photos.length === 0 && !canManage) return null;

  const [first, ...rest] = photos;

  function frame(photo: RecipePhoto, className: string) {
    return (
      <Plate key={photo.id} className={`bg-done ${className}`}>
        <img
          src={photo.url}
          alt={photo.caption ?? t('plating.alt')}
          className="absolute inset-0 h-full w-full object-cover"
        />
        {canManage ? (
          <button
            type="button"
            className="btn-small bg-surface-raised absolute top-2 right-2"
            onClick={() =>
              confirmingPhoto === photo.id
                ? remove.mutate(photo.id, { onSettled: () => setConfirmingPhoto(null) })
                : setConfirmingPhoto(photo.id)
            }
            disabled={remove.isPending}
            aria-label={t('plating.remove')}
          >
            {confirmingPhoto === photo.id ? t('common.reallyDelete') : '✕'}
          </button>
        ) : null}
      </Plate>
    );
  }

  return (
    <section className="border-line bg-surface border-t px-4 py-5 sm:px-8 sm:py-6">
      <div className="mb-3.5 flex items-center gap-3">
        <h2 className="heading-rule flex-1 text-[22px]">{t('plating.title')}</h2>
      </div>

      {first ? (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            {frame(first, 'h-[240px] sm:h-[300px]')}
            {rest.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-col">
                {rest.slice(0, 2).map((photo) => frame(photo, 'h-[140px] sm:h-auto sm:flex-1'))}
              </div>
            ) : null}
          </div>
          {rest.length > 2 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {rest.slice(2).map((photo) => frame(photo, 'h-[140px] sm:h-[160px]'))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-ink-soft border-line border-2 border-dashed p-6 text-center sm:p-8">
          {t('plating.empty')}
        </p>
      )}

      {canManage ? (
        <div className="no-print mt-4">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="btn-quiet w-full sm:w-auto"
            onClick={() => input.current?.click()}
            disabled={upload.isPending}
          >
            {upload.isPending
              ? t('plating.uploading')
              : first
                ? t('plating.addAnother')
                : t('plating.add')}
          </button>
          {upload.error ? (
            <p role="alert" className="text-danger mt-3 text-sm">
              {errorMessage(translator, upload.error)}
            </p>
          ) : null}
          {remove.error ? (
            <p role="alert" className="text-danger mt-3 text-sm">
              {errorMessage(translator, remove.error)}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * The sheet taped inside the pass. A4, black only: no navigation, no tints, no
 * grey type, and the one boxed thing on the page is the allergen. The footer
 * repeats the size, because a sheet taped up for three weeks needs to say
 * which size it is.
 */
function PrintSheet({
  recipe,
  stationName,
  kitchenName,
  size,
  lines,
  contains,
  mayContain,
}: {
  recipe: Recipe;
  stationName: string | null;
  kitchenName: string;
  size: Size;
  lines: ExpandedLine[];
  contains: string[];
  mayContain: string[];
}) {
  const translator = useT();
  const { t, plural, locale } = translator;
  const printed = new Date();
  const keeps = [
    recipe.shelfLifeHours ? plural('recipe.keeps', recipe.shelfLifeHours) : null,
    recipe.storage,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <article className="hidden text-black [--indent:26px] print:block">
      <header className="flex items-start justify-between gap-5 border-b-[3px] border-black pb-3.5">
        <div>
          <h1 className="text-[40pt] leading-[0.95]">{recipe.name}</h1>
          <p className="mt-1.5 text-[12pt] tracking-[0.04em]">
            {[recipeTypeName(t, recipe.type), stationName, size.makes, size.note]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="text-right text-[10pt] leading-normal tracking-[0.04em]">
          <p className="font-display text-[13pt] font-semibold tracking-[0.12em] uppercase">
            {kitchenName}
          </p>
          <p>
            {t('print.printed', {
              date: printed.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }),
              time: clockTime(locale, printed),
            })}
          </p>
          {keeps ? <p>{keeps}</p> : null}
        </div>
      </header>

      <div className="keep-together mt-[18px] border-[3px] border-black px-4 py-3">
        <span className="font-display text-[13pt] font-semibold tracking-[0.16em] uppercase">
          {t('recipe.contains')}
        </span>
        <span className="font-display mt-0.5 block text-[24pt] leading-none font-semibold">
          {contains.length > 0 ? contains.join(', ') : t('recipe.nothingDeclarable')}
        </span>
        {mayContain.length > 0 ? (
          <span className="mt-1 block text-[11pt]">
            {t('recipe.mayContain', {
              allergens: mayContain.map((name) => inSentence(translator, name)).join(', '),
            })}
          </span>
        ) : null}
      </div>

      <section className="mt-6">
        <PrintHeading>{t('print.whatGoesIn')}</PrintHeading>
        {lines.map((line, index) => (
          <div
            key={`${line.sourceId}-${index}`}
            className="grid grid-cols-[18pt_72pt_1fr] items-baseline gap-3 border-b-[0.75px] border-[#b8b8b8] py-[7px]"
          >
            <span className="font-mono text-[8pt] text-[#666]">{line.depth}</span>
            <span className="font-display text-right text-[17pt] leading-none font-semibold">
              {amount(line.quantity.value, line.quantity.unit)}
            </span>
            <span className="relative" style={indentStyle(line.depth)}>
              <Leaders depth={line.depth} print />
              <span className={`text-[12.5pt] ${line.depth === 0 ? 'font-semibold' : ''}`}>
                {line.name}
              </span>
              {line.note ? (
                <span className="block text-[10.5pt] text-[#444]">{line.note}</span>
              ) : null}
            </span>
          </div>
        ))}
      </section>

      {recipe.method.length > 0 ? (
        <section className="mt-6">
          <PrintHeading>{t('recipe.method')}</PrintHeading>
          <ol className="mt-2.5 flex flex-col gap-2">
            {recipe.method.map((step, index) => (
              <li key={index} className="grid grid-cols-[20pt_1fr] items-baseline gap-3">
                <span className="font-display text-right text-[15pt] font-semibold">
                  {index + 1}
                </span>
                <span className="text-[12.5pt] leading-[1.4]">{step.text}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <footer className="mt-8 flex justify-between gap-5 border-t-[1.5px] border-black pt-3 text-[10.5pt] tracking-[0.04em]">
        <span>{keeps}</span>
        <span>
          {recipe.name} · {size.note}
        </span>
      </footer>
    </article>
  );
}

function PrintHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-display border-b-[1.5px] border-black pb-1 text-[13pt] font-semibold tracking-[0.16em] uppercase">
      {children}
    </h2>
  );
}

function amount(value: number, unit: string): string {
  return isUnitCode(unit) ? formatQuantity(humanize({ value, unit })) : `${round(value)} ${unit}`;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
