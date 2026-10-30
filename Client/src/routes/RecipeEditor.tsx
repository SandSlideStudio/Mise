import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import type {
  ComponentRef,
  Course,
  CreateRecipeComponent,
  Recipe,
  RecipeStatus,
  RecipeType,
  ServingTemperature,
} from '@mise/contracts';
import {
  ALLERGENS,
  ALL_UNITS,
  COURSES,
  ONE_PLATE,
  SERVING_TEMPERATURES,
  type Allergen,
  type UnitCode,
} from '@mise/domain';
import { useStations } from '../api/kitchen.js';
import { useCreateRecipe, useRecipe, useRecipeAllergens, useUpdateRecipe } from '../api/recipes.js';
import { AppShell } from '../components/AppShell.js';
import { LoadError } from '../components/LoadError.js';
import { ComponentPicker } from '../components/ComponentPicker.js';
import { Plate } from '../components/Plate.js';
import {
  allergenName,
  courseName,
  errorMessage,
  recipeStatusName,
  recipeTypeName,
  temperatureName,
  useT,
} from '../i18n/index.js';

/**
 * The recipe editor.
 *
 * The screen a chef spends hours in, and the one adoption turns on. A line is
 * one row of cells, so a book goes in left to right: Enter drops you onto the
 * next line with the section carried over, and Enter on a name the book does
 * not know creates it without a dialog over a half-typed recipe. Everything
 * that is not a line lives in a rail beside them.
 */

interface EditorLine {
  key: string;
  ref: ComponentRef | null;
  displayName: string;
  amount: string;
  unit: UnitCode;
  note: string;
  section: string;
}

type LineField = 'picker' | 'amount' | 'unit' | 'note';

/** Column widths of a line, shared with its heading so they line up. */
const LINE_COLUMNS = 'lg:grid-cols-[96px_minmax(0,1fr)_96px_84px_minmax(0,220px)_100px]';

/** "romig, knoflook, fris" into a list, and back. */
function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

let lineCounter = 0;
function blankLine(section = ''): EditorLine {
  return {
    key: `line-${++lineCounter}`,
    ref: null,
    displayName: '',
    amount: '',
    unit: 'g',
    note: '',
    section,
  };
}

export function RecipeEditor() {
  const { t } = useT();
  const params = useParams({ strict: false }) as { recipeId?: string };
  const recipeId = params.recipeId;
  const existing = useRecipe(recipeId);

  if (recipeId && existing.isPending) {
    return (
      <AppShell>
        <main className="text-ink-soft mx-auto max-w-[1340px] px-5 py-10">
          {t('common.loading')}
        </main>
      </AppShell>
    );
  }

  if (recipeId && existing.isError) {
    return (
      <AppShell>
        <main className="mx-auto max-w-[1340px] px-5 py-10">
          <LoadError onRetry={() => void existing.refetch()} />
        </main>
      </AppShell>
    );
  }

  return <EditorForm key={recipeId ?? 'new'} recipe={existing.data} />;
}

/** A new recipe opened from the Dishes page starts out as a dish. */
function typeFromAddress(): RecipeType {
  const asked = new URLSearchParams(window.location.search).get('type');
  return asked === 'dish' || asked === 'component' ? asked : 'prep';
}

function EditorForm({ recipe }: { recipe?: Recipe }) {
  const translator = useT();
  const { t, plural, locale } = translator;
  const navigate = useNavigate();
  const stations = useStations();
  const create = useCreateRecipe();
  const update = useUpdateRecipe(recipe?.id ?? '');

  const [name, setName] = useState(recipe?.name ?? '');
  const [type, setType] = useState<RecipeType>(() => recipe?.type ?? typeFromAddress());
  const [status, setStatus] = useState<RecipeStatus>(recipe?.status ?? 'draft');
  const [stationId, setStationId] = useState(recipe?.stationId ?? '');
  const [yieldAmount, setYieldAmount] = useState(String(recipe?.yield.value ?? ''));
  const [yieldUnit, setYieldUnit] = useState<UnitCode>((recipe?.yield.unit as UnitCode) ?? 'kg');
  const [prepMinutes, setPrepMinutes] = useState(
    recipe?.prepMinutes ? String(recipe.prepMinutes) : '',
  );
  const [shelfLifeHours, setShelfLifeHours] = useState(
    recipe?.shelfLifeHours ? String(recipe.shelfLifeHours) : '',
  );
  const [storage, setStorage] = useState(recipe?.storage ?? '');
  const [tags, setTags] = useState((recipe?.tags ?? []).join(', '));
  const [mayContain, setMayContain] = useState<Allergen[]>(
    (recipe?.mayContain ?? []) as Allergen[],
  );
  const [flavour, setFlavour] = useState((recipe?.flavourProfile ?? []).join(', '));
  const [temperature, setTemperature] = useState<ServingTemperature | ''>(
    recipe?.servingTemperature ?? '',
  );
  const [course, setCourse] = useState<Course | ''>(recipe?.course ?? '');
  const [drinks, setDrinks] = useState((recipe?.drinkPairings ?? []).join(', '));
  const [cutlery, setCutlery] = useState((recipe?.cutlery ?? []).join(', '));
  const [steps, setSteps] = useState<string[]>((recipe?.method ?? []).map((s) => s.text));
  const [lines, setLines] = useState<EditorLine[]>(() =>
    (recipe?.components ?? []).length > 0
      ? recipe!.components.map((component) => ({
          key: component.id,
          ref: component.ref,
          displayName: component.displayName ?? '',
          amount: String(component.quantity.value),
          unit: component.quantity.unit as UnitCode,
          note: component.note ?? '',
          section: component.section ?? '',
        }))
      : [blankLine()],
  );

  // Moving between cells from the keyboard: remember where focus should land
  // and put it there once the new line exists.
  const fields = useRef(new Map<string, HTMLElement>());
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!focusTarget) return;
    const element = fields.current.get(focusTarget);
    if (element) {
      element.focus();
      if (element instanceof HTMLInputElement && focusTarget.endsWith(':section')) {
        element.select();
      }
    }
    setFocusTarget(null);
  }, [focusTarget, lines]);

  function register(id: string) {
    return (element: HTMLElement | null) => {
      if (element) fields.current.set(id, element);
      else fields.current.delete(id);
    };
  }

  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  // A dish has no batch: a new one is one plate, and one that was already a
  // dish keeps the size its components were written for.
  const isDish = type === 'dish';
  const dishSize =
    recipe?.type === 'dish'
      ? { yield: recipe.yield, portions: recipe.portions ?? ONE_PLATE.portions }
      : ONE_PLATE;

  function updateLine(key: string, patch: Partial<EditorLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function insertAfter(index: number) {
    const fresh = blankLine(lines[index]?.section ?? '');
    setLines((current) => {
      const next = [...current];
      next.splice(index + 1, 0, fresh);
      return next;
    });
    setFocusTarget(`${fresh.key}:picker`);
  }

  function addSection() {
    const count = new Set(lines.map((line) => line.section).filter(Boolean)).size;
    const fresh = blankLine(t('editor.newSection', { count: count + 1 }));
    setLines((current) => [...current, fresh]);
    setFocusTarget(`${fresh.key}:section`);
  }

  function move(index: number, direction: -1 | 1, refocus?: string) {
    setLines((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      return next;
    });
    if (refocus) setFocusTarget(refocus);
  }

  /** Renaming a heading renames the run of lines underneath it. */
  function renameSection(index: number, value: string) {
    setLines((current) => {
      const old = current[index]!.section;
      const next = [...current];
      for (let i = index; i < next.length && next[i]!.section === old; i++) {
        next[i] = { ...next[i]!, section: value };
      }
      return next;
    });
  }

  function onLineKey(event: KeyboardEvent<HTMLElement>, index: number, field: LineField) {
    const line = lines[index]!;
    if (event.key === 'Enter') {
      event.preventDefault();
      insertAfter(index);
    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      move(index, event.key === 'ArrowUp' ? -1 : 1, `${line.key}:${field}`);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();

    const components: CreateRecipeComponent[] = lines
      .filter((line) => line.ref !== null && line.amount !== '')
      .map((line, index) => ({
        sortOrder: index,
        section: line.section || null,
        note: line.note || null,
        quantity: { value: Number(line.amount), unit: line.unit },
        ref: line.ref!,
      }));

    const payload = {
      name,
      type,
      status,
      stationId: stationId || null,
      yield: isDish ? dishSize.yield : { value: Number(yieldAmount), unit: yieldUnit },
      portions: isDish ? dishSize.portions : null,
      prepMinutes: !isDish && prepMinutes ? Number(prepMinutes) : null,
      shelfLifeHours: !isDish && shelfLifeHours ? Number(shelfLifeHours) : null,
      storage: (!isDish && storage) || null,
      method: steps.filter((step) => step.trim()).map((text) => ({ text })),
      tags: splitList(tags),
      declaredAllergens: [],
      mayContain,
      flavourProfile: splitList(flavour),
      servingTemperature: temperature || null,
      course: course || null,
      drinkPairings: splitList(drinks),
      cutlery: splitList(cutlery),
      components,
    };

    // A dish lives on the Dishes page, as its card; everything else in the book.
    const onSuccess = (saved: Recipe) =>
      saved.type === 'dish'
        ? void navigate({ to: '/dishes/$dishId', params: { dishId: saved.id } })
        : void navigate({ to: '/recipes/$recipeId', params: { recipeId: saved.id } });

    if (recipe) update.mutate(payload, { onSuccess });
    else create.mutate(payload, { onSuccess });
  }

  const filled = lines.filter((line) => line.ref !== null).length;

  return (
    <AppShell>
      <form onSubmit={onSubmit} className="mx-auto max-w-[1340px] px-4 py-6 sm:px-6 sm:py-8">
        <Plate className="bg-surface">
          <div className="bg-surface-raised border-line flex flex-wrap items-center gap-x-5 gap-y-3 border-b px-4 py-4 sm:px-6">
            <span className="eyebrow text-[13px]">
              {recipe ? t('editor.editing') : t('recipes.new')}
            </span>
            <input
              aria-label={t('editor.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('editor.namePlaceholder')}
              required
              autoFocus={!recipe}
              className="font-display text-ink border-field focus-visible:border-accent placeholder:text-ink-faint min-w-0 flex-1 border-b-2 bg-transparent px-1 pb-0.5 text-[30px] font-semibold focus-visible:outline-none sm:max-w-[420px] sm:text-[34px]"
            />
            <select
              aria-label={t('editor.status')}
              value={status}
              onChange={(e) => setStatus(e.target.value as RecipeStatus)}
              className={`tag h-8 cursor-pointer bg-transparent text-[13px] ${
                status === 'published' ? 'tag-brand' : status === 'draft' ? 'tag-accent' : ''
              }`}
            >
              {(['draft', 'published', 'archived'] as const).map((value) => (
                <option key={value} value={value}>
                  {recipeStatusName(t, value)}
                </option>
              ))}
            </select>
            <span className="text-ink-soft ml-auto text-sm">
              {pending
                ? t('common.saving')
                : recipe
                  ? t('editor.lastSaved', {
                      time: new Date(recipe.updatedAt).toLocaleString(locale, {
                        weekday: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      }),
                    })
                  : t('editor.notSaved')}
            </span>
            <button
              type="button"
              className="btn-quiet min-h-11 px-4"
              onClick={() =>
                recipe
                  ? void navigate({ to: '/recipes/$recipeId', params: { recipeId: recipe.id } })
                  : void navigate({ to: type === 'dish' ? '/dishes' : '/recipes' })
              }
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="btn-primary min-h-11 px-[22px] text-xl"
              disabled={pending}
            >
              {t('common.save')}
            </button>
          </div>

          {error ? (
            <p
              role="alert"
              className="border-danger bg-danger/10 text-danger border-b px-4 py-3 text-[17px] sm:px-6"
            >
              {errorMessage(translator, error)}
            </p>
          ) : null}

          <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="border-line lg:border-r">
              <div
                className={`col-head hidden items-center gap-3 px-6 py-2.5 lg:grid ${LINE_COLUMNS}`}
              >
                <span>{t('editor.colSort')}</span>
                <span>{t('editor.colWhat')}</span>
                <span className="text-right">{t('common.howMuch')}</span>
                <span>{t('common.unit')}</span>
                <span>{t('editor.colNote')}</span>
                <span />
              </div>

              {lines.map((line, index) => {
                const previous = lines[index - 1];
                const startsSection =
                  index === 0 ? line.section !== '' : previous!.section !== line.section;

                return (
                  <div key={line.key}>
                    {startsSection ? (
                      <div className="bg-surface flex items-center gap-3 px-4 pt-3.5 pb-1.5 sm:px-6">
                        <input
                          ref={register(`${line.key}:section`)}
                          aria-label={t('editor.sectionHeading')}
                          value={line.section}
                          size={Math.max(10, line.section.length + 1)}
                          placeholder={t('editor.sectionHeading')}
                          onChange={(e) => renameSection(index, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              setFocusTarget(`${line.key}:picker`);
                            }
                          }}
                          className="font-display text-brand placeholder:text-ink-faint focus-visible:border-accent max-w-[70%] border-b border-transparent bg-transparent text-lg font-semibold tracking-[0.14em] uppercase focus-visible:outline-none"
                        />
                        <span className="bg-field h-px flex-1" aria-hidden />
                        <button
                          type="button"
                          className="text-ink-faint hover:text-ink text-xs tracking-[0.1em] uppercase"
                          onClick={() => renameSection(index, previous?.section ?? '')}
                        >
                          {t('editor.removeHeading')}
                        </button>
                      </div>
                    ) : null}

                    <div
                      className={`bg-surface-raised border-rule grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 border-t px-4 py-2 sm:px-6 lg:gap-3 lg:py-1.5 ${LINE_COLUMNS}`}
                    >
                      <KindTag line={line} />
                      <div className="col-span-3 lg:col-span-1">
                        <ComponentPicker
                          value={line.ref}
                          displayName={line.displayName}
                          excludeRecipeId={recipe?.id}
                          inputRef={register(`${line.key}:picker`)}
                          onChange={(ref, displayName) =>
                            updateLine(line.key, { ref, displayName })
                          }
                          onChosen={() => setFocusTarget(`${line.key}:amount`)}
                          onKeyDown={(e) => onLineKey(e, index, 'picker')}
                        />
                      </div>
                      <input
                        ref={register(`${line.key}:amount`)}
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min={0}
                        value={line.amount}
                        onChange={(e) => updateLine(line.key, { amount: e.target.value })}
                        onKeyDown={(e) => onLineKey(e, index, 'amount')}
                        placeholder="0"
                        aria-label={t('common.howMuch')}
                        className="field qty h-11 text-right text-[22px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <select
                        ref={register(`${line.key}:unit`)}
                        value={line.unit}
                        onChange={(e) => updateLine(line.key, { unit: e.target.value as UnitCode })}
                        onKeyDown={(e) => onLineKey(e, index, 'unit')}
                        aria-label={t('common.unit')}
                        className="field h-11"
                      >
                        {ALL_UNITS.map((unit) => (
                          <option key={unit.code} value={unit.code}>
                            {unit.code}
                          </option>
                        ))}
                      </select>
                      <input
                        ref={register(`${line.key}:note`)}
                        value={line.note}
                        onChange={(e) => updateLine(line.key, { note: e.target.value })}
                        onKeyDown={(e) => onLineKey(e, index, 'note')}
                        placeholder={t('editor.notePlaceholder')}
                        aria-label={t('editor.colNote')}
                        className="field text-ink-soft order-last col-span-3 h-11 lg:order-none lg:col-span-1"
                      />
                      <span className="flex gap-1 justify-self-end">
                        <CellButton
                          label={t('common.moveUp')}
                          onClick={() => move(index, -1)}
                          disabled={index === 0}
                        >
                          ↑
                        </CellButton>
                        <CellButton
                          label={t('common.moveDown')}
                          onClick={() => move(index, 1)}
                          disabled={index === lines.length - 1}
                        >
                          ↓
                        </CellButton>
                        <CellButton
                          label={t('editor.removeLine')}
                          onClick={() =>
                            setLines((current) =>
                              current.length === 1
                                ? [blankLine()]
                                : current.filter((l) => l.key !== line.key),
                            )
                          }
                        >
                          ✕
                        </CellButton>
                      </span>
                    </div>
                  </div>
                );
              })}

              <div className="bg-surface border-line flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-3.5 sm:px-6">
                <button
                  type="button"
                  className="btn-quiet min-h-10 px-4"
                  onClick={() => insertAfter(lines.length - 1)}
                >
                  {t('editor.addLine')}
                </button>
                <button type="button" className="btn-quiet min-h-10 px-4" onClick={addSection}>
                  {t('editor.addSection')}
                </button>
                <span className="text-ink-soft text-[13px]">{plural('editor.lines', filled)}</span>
                <span className="text-ink-soft ml-auto hidden gap-[18px] text-[13px] xl:flex">
                  <Hint keys="↵">{t('editor.hintNext')}</Hint>
                  <Hint keys="⇥">{t('editor.hintField')}</Hint>
                  <Hint keys="Alt ↑ ↓">{t('editor.hintMove')}</Hint>
                  <Hint keys="↵">{t('editor.hintCreate')}</Hint>
                </span>
              </div>

              <div className="bg-surface border-line border-t px-4 py-5 sm:px-6">
                <h2 className="heading-rule mb-3">{t('recipe.method')}</h2>
                <MethodEditor steps={steps} onChange={setSteps} />
              </div>
            </div>

            <aside className="bg-surface border-line flex flex-col gap-[18px] border-t px-4 py-5 sm:px-[22px] lg:border-t-0">
              <h2 className="font-display text-brand text-xl font-semibold tracking-[0.14em] uppercase">
                {t('editor.theRest')}
              </h2>

              <div className="grid grid-cols-2 gap-3">
                <RailField label={t('common.station')} htmlFor="station">
                  <select
                    id="station"
                    className="field min-h-10"
                    value={stationId}
                    onChange={(e) => setStationId(e.target.value)}
                  >
                    <option value="">{t('common.none')}</option>
                    {(stations.data ?? []).map((station) => (
                      <option key={station.id} value={station.id}>
                        {station.name}
                      </option>
                    ))}
                  </select>
                </RailField>

                <RailField label={t('recipes.sort')} htmlFor="type">
                  <select
                    id="type"
                    className="field min-h-10"
                    value={type}
                    onChange={(e) => setType(e.target.value as RecipeType)}
                  >
                    {(['dish', 'prep', 'component'] as const).map((value) => (
                      <option key={value} value={value}>
                        {recipeTypeName(t, value)}
                      </option>
                    ))}
                  </select>
                </RailField>

                {isDish ? null : (
                  <>
                    <RailField
                      label={t('editor.batchMakes')}
                      htmlFor="yieldAmount"
                      className="col-span-2"
                    >
                      <span className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
                        <input
                          id="yieldAmount"
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min={0}
                          className="field qty min-h-10 text-xl"
                          value={yieldAmount}
                          onChange={(e) => setYieldAmount(e.target.value)}
                          required
                        />
                        <select
                          aria-label={t('editor.yieldUnit')}
                          className="field min-h-10"
                          value={yieldUnit}
                          onChange={(e) => setYieldUnit(e.target.value as UnitCode)}
                        >
                          {ALL_UNITS.map((unit) => (
                            <option key={unit.code} value={unit.code}>
                              {unit.code}
                            </option>
                          ))}
                        </select>
                      </span>
                    </RailField>

                    <RailField label={t('editor.prepMinutes')} htmlFor="prepMinutes">
                      <input
                        id="prepMinutes"
                        type="number"
                        min={0}
                        className="field min-h-10"
                        value={prepMinutes}
                        onChange={(e) => setPrepMinutes(e.target.value)}
                      />
                    </RailField>

                    <RailField label={t('editor.keepsHours')} htmlFor="shelfLife">
                      <input
                        id="shelfLife"
                        type="number"
                        min={0}
                        className="field min-h-10"
                        value={shelfLifeHours}
                        onChange={(e) => setShelfLifeHours(e.target.value)}
                      />
                    </RailField>
                  </>
                )}
              </div>

              {isDish ? (
                <p className="text-ink-soft text-sm">
                  {plural('editor.dishPlates', dishSize.portions)}
                </p>
              ) : (
                <RailField label={t('recipe.storage')} htmlFor="storage">
                  <input
                    id="storage"
                    className="field min-h-10"
                    value={storage}
                    onChange={(e) => setStorage(e.target.value)}
                    placeholder={t('editor.storagePlaceholder')}
                  />
                </RailField>
              )}

              <RailField label={t('editor.tags')} htmlFor="tags">
                <input
                  id="tags"
                  className="field min-h-10"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder={t('editor.tagsPlaceholder')}
                />
              </RailField>

              {type === 'dish' ? (
                <>
                  <div className="bg-field h-px" />
                  <FrontOfHouse
                    flavour={flavour}
                    onFlavour={setFlavour}
                    temperature={temperature}
                    onTemperature={setTemperature}
                    course={course}
                    onCourse={setCourse}
                    drinks={drinks}
                    onDrinks={setDrinks}
                    cutlery={cutlery}
                    onCutlery={setCutlery}
                  />
                </>
              ) : null}

              <div className="bg-field h-px" />

              <AllergenRollup recipeId={recipe?.id} />

              <fieldset className="flex flex-col gap-2">
                <legend className="eyebrow mb-2">{t('editor.mayContain')}</legend>
                <div className="flex flex-wrap gap-1.5">
                  {ALLERGENS.map((allergen) => (
                    <button
                      key={allergen}
                      type="button"
                      aria-pressed={mayContain.includes(allergen)}
                      onClick={() =>
                        setMayContain((current) =>
                          current.includes(allergen)
                            ? current.filter((a) => a !== allergen)
                            : [...current, allergen],
                        )
                      }
                      className="toggle px-2.5 py-1 text-[13px]"
                    >
                      {allergenName(t, allergen)}
                    </button>
                  ))}
                </div>
              </fieldset>
            </aside>
          </div>
        </Plate>
      </form>
    </AppShell>
  );
}

function KindTag({ line }: { line: EditorLine }) {
  const { t } = useT();
  const [label, tone] =
    line.ref?.kind === 'recipe'
      ? [t('editor.kindRecipe'), 'tag-brand']
      : line.ref?.kind === 'ingredient'
        ? [t('editor.kindIngredient'), '']
        : [t('editor.kindNew'), 'tag-accent'];
  return (
    <span className={`tag hidden justify-self-start px-2 text-[11px] lg:inline-flex ${tone}`}>
      {label}
    </span>
  );
}

function CellButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      tabIndex={-1}
      className="border-field bg-surface-raised text-ink-soft hover:text-ink h-11 w-[30px] border text-[15px] disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function Hint({ keys, children }: { keys: string; children: ReactNode }) {
  return (
    <span>
      <kbd className="font-mono font-bold">{keys}</kbd> {children}
    </span>
  );
}

function RailField({
  label,
  htmlFor,
  hint,
  className = '',
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`flex flex-col gap-[5px] ${className}`}>
      <label className="eyebrow" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <span className="text-ink-faint text-xs">{hint}</span> : null}
    </span>
  );
}

/**
 * What the dish card says beyond the spec. Only a dish has one, so only a
 * dish shows these; a stock keeps whatever it had, untouched.
 */
function FrontOfHouse(props: {
  flavour: string;
  onFlavour: (value: string) => void;
  temperature: ServingTemperature | '';
  onTemperature: (value: ServingTemperature | '') => void;
  course: Course | '';
  onCourse: (value: Course | '') => void;
  drinks: string;
  onDrinks: (value: string) => void;
  cutlery: string;
  onCutlery: (value: string) => void;
}) {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-[18px]">
      <div>
        <h2 className="font-display text-brand text-xl font-semibold tracking-[0.14em] uppercase">
          {t('editor.frontOfHouse')}
        </h2>
        <p className="text-ink-faint text-xs">{t('editor.frontOfHouseHint')}</p>
      </div>

      <div className="grid gap-3">
        <RailField label={t('editor.temperature')} htmlFor="temperature">
          <select
            id="temperature"
            className="field min-h-10"
            value={props.temperature}
            onChange={(e) => props.onTemperature(e.target.value as ServingTemperature | '')}
          >
            <option value="">{t('editor.notSet')}</option>
            {SERVING_TEMPERATURES.map((value) => (
              <option key={value} value={value}>
                {temperatureName(t, value)}
              </option>
            ))}
          </select>
        </RailField>
        <RailField label={t('editor.course')} htmlFor="course">
          <select
            id="course"
            className="field min-h-10"
            value={props.course}
            onChange={(e) => props.onCourse(e.target.value as Course | '')}
          >
            <option value="">{t('editor.notSet')}</option>
            {COURSES.map((value) => (
              <option key={value} value={value}>
                {courseName(t, value)}
              </option>
            ))}
          </select>
        </RailField>
      </div>

      <RailField label={t('editor.flavour')} htmlFor="flavour" hint={t('editor.listHint')}>
        <input
          id="flavour"
          className="field min-h-10"
          value={props.flavour}
          onChange={(e) => props.onFlavour(e.target.value)}
          placeholder={t('editor.flavourPlaceholder')}
        />
      </RailField>
      <RailField label={t('editor.drinks')} htmlFor="drinks">
        <input
          id="drinks"
          className="field min-h-10"
          value={props.drinks}
          onChange={(e) => props.onDrinks(e.target.value)}
          placeholder={t('editor.drinksPlaceholder')}
        />
      </RailField>
      <RailField label={t('editor.cutlery')} htmlFor="cutlery">
        <input
          id="cutlery"
          className="field min-h-10"
          value={props.cutlery}
          onChange={(e) => props.onCutlery(e.target.value)}
          placeholder={t('editor.cutleryPlaceholder')}
        />
      </RailField>
    </div>
  );
}

/**
 * Allergens are worked out, never typed. The rail states where they came from
 * rather than asking for them.
 */
function AllergenRollup({ recipeId }: { recipeId?: string }) {
  const { t } = useT();
  const profile = useRecipeAllergens(recipeId);
  const contains = ((profile.data?.contains ?? []) as Allergen[]).map((a) => allergenName(t, a));

  return (
    <div className="flex flex-col gap-2">
      <span className="eyebrow">{t('editor.rolledUp')}</span>
      <div className="border-ink bg-surface-raised border px-3 py-2.5">
        {!recipeId ? (
          <span className="text-ink-soft text-[13px]">{t('editor.rollupUnsaved')}</span>
        ) : contains.length > 0 ? (
          <>
            <span className="font-display block text-lg leading-tight font-semibold tracking-[0.12em] uppercase">
              {t('editor.rollupContains', { allergens: contains.join(', ') })}
            </span>
            <span className="text-ink-soft mt-0.5 block text-[13px]">{t('editor.rollupNote')}</span>
          </>
        ) : (
          <span className="text-ink-soft text-[13px]">
            {profile.isPending ? t('common.working') : t('editor.rollupNone')}
          </span>
        )}
      </div>
    </div>
  );
}

function MethodEditor({
  steps,
  onChange,
}: {
  steps: string[];
  onChange: (steps: string[]) => void;
}) {
  const { t } = useT();
  const boxes = useRef<(HTMLTextAreaElement | null)[]>([]);

  // Always leave one empty box at the end so there is somewhere to type.
  useEffect(() => {
    if (steps.length === 0 || steps[steps.length - 1]?.trim() !== '') {
      onChange([...steps, '']);
    }
  }, [steps, onChange]);

  return (
    <ol className="flex flex-col gap-1.5">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <li key={index} className="grid grid-cols-[28px_minmax(0,1fr)_30px] items-start gap-2.5">
            <span className="text-ink-faint pt-3 text-right font-mono text-[13px]">
              {index + 1}
            </span>
            <textarea
              ref={(element) => {
                boxes.current[index] = element;
              }}
              rows={1}
              value={step}
              onChange={(e) => {
                const next = [...steps];
                next[index] = e.target.value;
                onChange(next);
              }}
              onKeyDown={(e) => {
                // Enter moves on to the next step; Shift and Enter breaks a line.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  boxes.current[index + 1]?.focus();
                }
              }}
              placeholder={index === 0 ? t('editor.stepFirst') : t('editor.stepNext')}
              aria-label={t('editor.step', { count: index + 1 })}
              className={`field field-sizing-content min-h-11 resize-none py-2.5 text-[17px] leading-snug ${
                last && !step ? 'border-line border-dashed' : ''
              }`}
            />
            {!last || step ? (
              <button
                type="button"
                tabIndex={-1}
                className="border-field text-ink-soft hover:text-ink h-11 border text-sm"
                onClick={() => onChange(steps.filter((_, i) => i !== index))}
                aria-label={t('editor.removeStep', { count: index + 1 })}
              >
                ✕
              </button>
            ) : (
              <span />
            )}
          </li>
        );
      })}
    </ol>
  );
}
