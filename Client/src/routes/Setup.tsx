import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  LANGUAGES,
  ROLES,
  type Language,
  type RecipeType,
  type Role,
  type SetupRequest,
  type TickedRetention,
} from '@mise/contracts';
import { ALL_UNITS, ONE_PLATE, type UnitCode } from '@mise/domain';
import type { RestoreResult } from '@mise/contracts';
import { useRestoreBackup } from '../api/backups.js';
import { RequestFailed } from '../api/client.js';
import { useEnrollDevice } from '../api/kitchen.js';
import { useSetup, useSetupStatus } from '../api/session.js';
import { Plate } from '../components/Plate.js';
import {
  errorMessage,
  LANGUAGE_NAMES,
  roleName,
  usePreviewLanguage,
  useT,
  type MessageKey,
} from '../i18n/index.js';
import {
  BackButton,
  ForwardButton,
  PageHeading,
  ReadyPage,
  SetupFrame,
  StepIndex,
  usePageTurn,
  type TurnDirection,
} from './SetupFrame.js';
import { SelfHostNote, WelcomeAside, WelcomePage } from './Welcome.js';

/**
 * First run.
 *
 * There is no sign-up page anywhere else in Mise. A self-hosted server starts
 * with nobody in it, and these pages exist exactly once: a welcome, then name
 * the restaurant, create the administrator, lay out the stations and the
 * brigade, optionally start the recipe book, and choose how the kitchen runs.
 *
 * Nothing is sent until the last page. The server creates everything in one
 * transaction, so closing the browser halfway leaves nothing half-made.
 */

const STEPS = ['kitchen', 'you', 'brigade', 'recipes', 'settings', 'check'] as const;
type Step = (typeof STEPS)[number];
/** Welcome, the six steps, and the signed page that closes into the app. */
type Page = 'welcome' | Step | 'ready' | 'restore' | 'restored';

/** What a restore brings back, listed beside the form. */
const RESTORED = [
  'restore.asideStaff',
  'restore.asideRecipes',
  'restore.asidePrep',
  'restore.asideTablets',
] as const;

function isStep(page: Page): page is Step {
  return (STEPS as readonly string[]).includes(page);
}

/** How long the signed page stays before the frame closes, and how long closing takes. */
const READY_HOLD_MS = 1900;
const CLOSE_MS = 420;

const STEP_LABEL: Record<Step, MessageKey> = {
  kitchen: 'setup.stepKitchen',
  you: 'setup.stepYou',
  brigade: 'setup.stepBrigade',
  recipes: 'setup.stepRecipes',
  settings: 'setup.stepSettings',
  check: 'setup.stepCheck',
};

const STEP_TITLE: Record<Step, MessageKey> = {
  kitchen: 'setup.kitchenTitle',
  you: 'setup.youTitle',
  brigade: 'setup.brigadeTitle',
  recipes: 'setup.recipesTitle',
  settings: 'setup.settingsTitle',
  check: 'setup.checkTitle',
};

const STEP_BODY: Record<Step, MessageKey> = {
  kitchen: 'setup.kitchenBody',
  you: 'setup.youBody',
  brigade: 'setup.brigadeBody',
  recipes: 'setup.recipesBody',
  settings: 'setup.settingsBody',
  check: 'setup.checkBody',
};

const RECIPE_TYPES: RecipeType[] = ['dish', 'prep', 'component'];
const MIN_PASSWORD = 12;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN = /^\d{4,8}$/;

/** Stable keys for rows that have no id yet. Not crypto.randomUUID: plain HTTP on a LAN lacks it. */
let lastKey = 0;
const newKey = () => `row-${++lastKey}`;

interface StationDraft {
  key: string;
  name: string;
}

/** Setup only gives out PINs, and an administrator needs a password. */
type StaffRole = Exclude<Role, 'admin'>;

interface PersonDraft {
  key: string;
  displayName: string;
  role: StaffRole;
  stationKey: string;
  pin: string;
}

interface RecipeDraft {
  key: string;
  name: string;
  type: RecipeType;
  stationKey: string;
  yieldValue: string;
  yieldUnit: UnitCode;
}

/** Offered until the admin touches the list, in whatever language is chosen. */
const DEFAULT_STATIONS: { key: string; label: MessageKey }[] = [
  { key: 'larder', label: 'setup.defaultLarder' },
  { key: 'sauce', label: 'setup.defaultSauce' },
  { key: 'saute', label: 'setup.defaultSaute' },
  { key: 'grill', label: 'setup.defaultGrill' },
  { key: 'pastry', label: 'setup.defaultPastry' },
];

const sameName = (name: string) => name.trim().toLowerCase();
const toNumber = (value: string) => Number(value.replace(',', '.'));
const hasDuplicates = (names: string[]) => new Set(names.map(sameName)).size !== names.length;

export function Setup() {
  const translator = useT();
  const { t } = translator;
  const preview = usePreviewLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setup = useSetup();
  const enrol = useEnrollDevice();
  const restore = useRestoreBackup();
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [restored, setRestored] = useState<RestoreResult | null>(null);

  const [page, setPage] = useState<Page>('welcome');
  const [closing, setClosing] = useState(false);
  const [direction, setDirection] = useState<TurnDirection>('forward');
  const [attempted, setAttempted] = useState(false);

  const [language, setLanguage] = useState<Language>(translator.language);
  const [kitchenName, setKitchenName] = useState('');

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [editedStations, setEditedStations] = useState<StationDraft[] | null>(null);
  const stations =
    editedStations ??
    DEFAULT_STATIONS.map((station) => ({ key: station.key, name: t(station.label) }));
  const [staff, setStaff] = useState<PersonDraft[]>([]);
  const [recipes, setRecipes] = useState<RecipeDraft[]>([]);

  const [unitSystem, setUnitSystem] = useState<'metric' | 'imperial'>('metric');
  const [tickedRetention, setTickedRetention] = useState<TickedRetention>('keep');
  const [enrolDevice, setEnrolDevice] = useState(false);
  const [deviceName, setDeviceName] = useState('');

  // The one-time code a production server asks for. The installer's setup link
  // carries it; otherwise it's typed in on the last page.
  const status = useSetupStatus();
  const [linkCode] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '');
  const [code, setCode] = useState(linkCode);
  const codeRejected = [setup.error, restore.error].some(
    (error) => error instanceof RequestFailed && error.code === 'setup_token',
  );
  const askForCode = status.data?.setupTokenRequired === true && (!linkCode || codeRejected);

  /** -1 on the welcome page, 0 to 5 on the steps, 6 once it is all signed. */
  const index = isStep(page) ? STEPS.indexOf(page) : page === 'ready' ? STEPS.length : -1;
  const pending = setup.isPending || enrol.isPending || restore.isPending;

  // The frame follows the requested page at once; the text in the middle
  // follows a beat later, once the old page has turned away.
  const turn = usePageTurn(page, direction);
  const shown = turn.shown;

  function chooseLanguage(next: Language) {
    setLanguage(next);
    preview(next);
  }

  function problemsWith(which: Step): MessageKey[] {
    const found = new Set<MessageKey>();
    switch (which) {
      case 'kitchen':
        if (!kitchenName.trim()) found.add('setup.required');
        break;
      case 'you':
        if (!displayName.trim()) found.add('setup.required');
        if (!EMAIL.test(email.trim())) found.add('setup.emailInvalid');
        if (password.length < MIN_PASSWORD) found.add('setup.passwordShort');
        else if (password !== confirm) found.add('setup.passwordMismatch');
        break;
      case 'brigade': {
        const named = stations.filter((station) => station.name.trim());
        if (named.length === 0) found.add('setup.stationsEmpty');
        if (named.length !== stations.length) found.add('setup.required');
        if (hasDuplicates(named.map((station) => station.name)))
          found.add('setup.stationDuplicate');
        if (staff.some((person) => !person.displayName.trim())) found.add('setup.nameMissing');
        if (staff.some((person) => !PIN.test(person.pin))) found.add('setup.pinInvalid');
        break;
      }
      case 'recipes':
        if (recipes.some((recipe) => !recipe.name.trim())) found.add('setup.nameMissing');
        if (hasDuplicates(recipes.map((recipe) => recipe.name))) found.add('setup.recipeDuplicate');
        if (
          recipes.some((recipe) => recipe.type !== 'dish' && !(toNumber(recipe.yieldValue) > 0))
        ) {
          found.add('setup.yieldInvalid');
        }
        break;
      case 'settings':
        if (enrolDevice && !deviceName.trim()) found.add('setup.required');
        break;
      case 'check':
        if (askForCode && !code.trim()) found.add('setup.required');
        break;
    }
    return [...found];
  }

  function goTo(target: number) {
    // Moving forward means every page in between has to be right.
    for (let i = Math.max(index, 0); i < target; i += 1) {
      const blocked = STEPS[i]!;
      if (problemsWith(blocked).length > 0) {
        if (blocked !== page) {
          setDirection(i > index ? 'forward' : 'back');
          setPage(blocked);
        }
        setAttempted(true);
        return;
      }
    }
    setAttempted(false);
    setDirection(target > index ? 'forward' : 'back');
    setPage(STEPS[target]!);
  }

  function goBack() {
    if (index > 0) {
      goTo(index - 1);
      return;
    }
    setAttempted(false);
    setDirection('back');
    setPage('welcome');
  }

  function onSubmit() {
    if (pending || page === 'ready') return;
    if (page === 'restore') {
      startRestore();
      return;
    }
    if (page === 'restored') {
      void openRestored();
      return;
    }
    if (page === 'check') {
      if (problemsWith('check').length > 0) {
        setAttempted(true);
        return;
      }
      create();
    } else goTo(index + 1);
  }

  function create() {
    const stationName = (key: string) =>
      key ? (stations.find((station) => station.key === key)?.name.trim() ?? null) : null;

    const payload: SetupRequest = {
      // The one-time code from the setup link the installer prints.
      setupToken: code.trim() || undefined,
      kitchenName: kitchenName.trim(),
      displayName: displayName.trim(),
      email: email.trim(),
      password,
      language,
      unitSystem,
      tickedRetention,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      stations: stations.map((station) => station.name.trim()),
      staff: staff.map((person) => ({
        displayName: person.displayName.trim(),
        role: person.role,
        station: stationName(person.stationKey),
        pin: person.pin,
      })),
      recipes: recipes.map((recipe) => ({
        name: recipe.name.trim(),
        type: recipe.type,
        station: stationName(recipe.stationKey),
        ...(recipe.type === 'dish'
          ? ONE_PLATE
          : {
              yield: { value: toNumber(recipe.yieldValue), unit: recipe.yieldUnit },
              portions: null,
            }),
      })),
    };

    setup.mutate(payload, {
      onError: (error) => {
        // Set up already, from another tab or a lost reply: go and sign in.
        if (error instanceof RequestFailed && (error.status === 404 || error.status === 409)) {
          void queryClient.invalidateQueries({ queryKey: ['setup-status'] });
        }
      },
      onSuccess: async () => {
        if (enrolDevice) {
          try {
            await enrol.mutateAsync(deviceName.trim());
          } catch {
            // The kitchen exists either way; a tablet can be enrolled from Settings.
          }
        }
        // Signed: turn to the last page and let the tick draw, then close the
        // frame and open the kitchen. Only then is the server marked as set up,
        // so nothing redirects while the animation is still playing.
        setAttempted(false);
        setDirection('forward');
        setPage('ready');
        window.setTimeout(() => setClosing(true), READY_HOLD_MS);
        window.setTimeout(() => {
          queryClient.setQueryData(['setup-status'], {
            needsSetup: false,
            language,
            kitchenName: kitchenName.trim(),
            setupTokenRequired: false,
          });
          void navigate({ to: '/' });
        }, READY_HOLD_MS + CLOSE_MS);
      },
    });
  }

  // --- restoring a backup instead ------------------------------------------

  function restoreProblems(): MessageKey[] {
    const found: MessageKey[] = [];
    if (!backupFile) found.push('restore.fileMissing');
    if (!recoveryKey.trim()) found.push('restore.keyMissing');
    if (askForCode && !code.trim()) found.push('setup.required');
    return found;
  }

  function startRestore() {
    if (!backupFile || restoreProblems().length > 0) {
      setAttempted(true);
      return;
    }
    setAttempted(false);
    restore.mutate(
      { file: backupFile, recoveryKey, setupToken: code.trim() || undefined },
      {
        onError: (error) => {
          if (error instanceof RequestFailed && (error.status === 404 || error.status === 409)) {
            void queryClient.invalidateQueries({ queryKey: ['setup-status'] });
          }
        },
        onSuccess: (result) => {
          setRestored(result);
          setDirection('forward');
          setPage('restored');
        },
      },
    );
  }

  async function openRestored() {
    await queryClient.refetchQueries({ queryKey: ['setup-status'] });
    void navigate({ to: '/login' });
  }

  // --- station and row editing ---------------------------------------------

  function changeStations(next: StationDraft[]) {
    setEditedStations(next);
    // Somebody on a station that no longer exists goes back to none.
    const keys = new Set(next.map((station) => station.key));
    setStaff((rows) =>
      rows.map((row) => (keys.has(row.stationKey) ? row : { ...row, stationKey: '' })),
    );
    setRecipes((rows) =>
      rows.map((row) => (keys.has(row.stationKey) ? row : { ...row, stationKey: '' })),
    );
  }

  const problems = !attempted
    ? []
    : isStep(shown)
      ? problemsWith(shown)
      : shown === 'restore'
        ? restoreProblems()
        : [];

  // --- what is on the page -------------------------------------------------

  const footer =
    page === 'ready' ? null : page === 'welcome' ? (
      <>
        <div className="flex flex-wrap items-stretch gap-3">
          <ForwardButton autoFocus>{t('welcome.cta')}</ForwardButton>
          <button
            type="button"
            className="btn-quiet"
            onClick={() => {
              setAttempted(false);
              setDirection('forward');
              setPage('restore');
            }}
          >
            {t('restore.cta')}
          </button>
        </div>
        <SelfHostNote className="mt-3 hidden lg:grid xl:mt-5" />
      </>
    ) : page === 'restored' ? (
      <div className="flex">
        <ForwardButton autoFocus>{t('restore.signIn')}</ForwardButton>
      </div>
    ) : (
      <div className="flex items-stretch gap-3">
        <BackButton onClick={goBack} disabled={pending}>
          {t('setup.back')}
        </BackButton>
        <ForwardButton disabled={pending}>
          {page === 'restore'
            ? pending
              ? t('restore.restoring')
              : t('restore.submit')
            : page === 'check'
              ? pending
                ? t('common.creating')
                : t('setup.create')
              : page === 'recipes' && recipes.length === 0
                ? t('setup.skip')
                : t('setup.next')}
        </ForwardButton>
      </div>
    );

  const aside =
    page === 'welcome' ? (
      <WelcomeAside language={language} onLanguage={chooseLanguage} />
    ) : page === 'restore' || page === 'restored' ? (
      <Plate className="bg-surface-raised hidden flex-col gap-4 px-6 pt-[26px] pb-6 lg:flex xl:px-8 xl:pt-[34px] xl:pb-[30px]">
        <p className="text-ink-faint font-display text-[11px] font-semibold tracking-[0.16em] uppercase xl:text-xs">
          {t('restore.asideTitle')}
        </p>
        <ul className="flex flex-col">
          {RESTORED.map((key) => (
            <li key={key} className="border-line border-b py-3 text-[15px] last:border-b-0">
              {t(key)}
            </li>
          ))}
        </ul>
      </Plate>
    ) : (
      <Plate className="bg-surface-raised hidden flex-col gap-[22px] px-6 pt-[26px] pb-6 lg:flex xl:gap-[26px] xl:px-8 xl:pt-[34px] xl:pb-[30px]">
        <StepIndex position={index + 1} onPick={page === 'ready' ? undefined : (i) => goTo(i)} />
        {page === 'ready' ? null : (
          <p className="text-ink-soft text-[13px] leading-[1.45] text-pretty xl:text-sm xl:leading-normal">
            {t('welcome.lead2')}
          </p>
        )}
      </Plate>
    );

  return (
    <SetupFrame
      position={index + 1}
      language={language}
      onLanguage={chooseLanguage}
      onSubmit={onSubmit}
      turnKey={shown}
      turnClassName={turn.className}
      footer={footer}
      aside={aside}
      closing={closing}
    >
      {shown === 'welcome' ? (
        <WelcomePage />
      ) : shown === 'restore' ? (
        <>
          <PageHeading eyebrow={t('restore.eyebrow')} title={t('restore.title')}>
            {t('restore.body')}
          </PageHeading>
          <div className="page-late mt-7 flex max-w-[720px] flex-col gap-6 xl:mt-9">
            <Field label={t('restore.file')} htmlFor="backupFile">
              <input
                id="backupFile"
                type="file"
                className="field"
                onChange={(e) => setBackupFile(e.target.files?.[0] ?? null)}
              />
            </Field>
            <Field label={t('restore.key')} htmlFor="recoveryKey" hint={t('restore.keyHint')}>
              <input
                id="recoveryKey"
                className="field font-mono uppercase"
                value={recoveryKey}
                onChange={(e) => setRecoveryKey(e.target.value)}
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            {askForCode ? (
              <Field label={t('setup.codeLabel')} htmlFor="restoreCode" hint={t('setup.codeHint')}>
                <input
                  id="restoreCode"
                  className="field font-mono"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
            ) : null}
            {problems.length > 0 ? (
              <ul
                role="alert"
                className="fade-swap border-danger text-danger flex flex-col gap-1 border-l-2 pl-3 text-sm"
              >
                {problems.map((problem) => (
                  <li key={problem}>{t(problem)}</li>
                ))}
              </ul>
            ) : null}
            {restore.isPending ? (
              <p role="status" className="text-ink-soft">
                {t('restore.working')}
              </p>
            ) : null}
            {restore.error ? (
              <p role="alert" className="border-danger text-danger border-l-2 pl-3 text-sm">
                {errorMessage(translator, restore.error)}
              </p>
            ) : null}
          </div>
        </>
      ) : shown === 'restored' ? (
        <>
          <PageHeading
            eyebrow={t('restore.eyebrow')}
            title={t('restore.done', { kitchen: restored?.kitchenName ?? '' })}
          >
            {t('restore.doneBody')}
          </PageHeading>
          <p className="page-late mt-7 text-lg xl:mt-9">
            {t('restore.counts', {
              staff: restored?.staff ?? 0,
              recipes: restored?.recipes ?? 0,
              photos: restored?.photos ?? 0,
            })}
          </p>
        </>
      ) : shown === 'ready' ? (
        <ReadyPage kitchenName={kitchenName.trim()} />
      ) : (
        <>
          <PageHeading
            eyebrow={`${String(STEPS.indexOf(shown) + 1).padStart(2, '0')} · ${t(STEP_LABEL[shown])}`}
            title={t(STEP_TITLE[shown])}
            tag={shown === 'recipes' ? t('setup.optional') : undefined}
          >
            {t(STEP_BODY[shown])}
          </PageHeading>

          <div className="page-late mt-7 flex max-w-[720px] flex-col gap-6 xl:mt-9">
            {shown === 'kitchen' ? (
              <>
                <Field label={t('setup.kitchenName')} htmlFor="kitchenName">
                  <input
                    id="kitchenName"
                    className="field"
                    value={kitchenName}
                    onChange={(e) => setKitchenName(e.target.value)}
                    placeholder={t('setup.kitchenPlaceholder')}
                    autoFocus
                  />
                </Field>
                {/* The top bar carries the language buttons from a tablet up. */}
                <div className="sm:hidden">
                  <Field label={t('kitchen.language')} htmlFor="language">
                    <select
                      id="language"
                      className="field"
                      value={language}
                      onChange={(e) => chooseLanguage(e.target.value as Language)}
                    >
                      {LANGUAGES.map((code) => (
                        <option key={code} value={code}>
                          {LANGUAGE_NAMES[code]}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </>
            ) : null}

            {shown === 'you' ? (
              <>
                <Field label={t('setup.yourName')} htmlFor="displayName">
                  <input
                    id="displayName"
                    className="field"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={t('setup.yourNamePlaceholder')}
                    autoComplete="name"
                    autoFocus
                  />
                </Field>
                <Field label={t('common.email')} htmlFor="email">
                  <input
                    id="email"
                    type="email"
                    className="field"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="username"
                  />
                </Field>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field
                    label={t('common.password')}
                    htmlFor="password"
                    hint={t('setup.passwordHint')}
                  >
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      className="field"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                  </Field>
                  <Field label={t('setup.confirmPassword')} htmlFor="confirmPassword">
                    <input
                      id="confirmPassword"
                      type={showPassword ? 'text' : 'password'}
                      className="field"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      autoComplete="new-password"
                    />
                  </Field>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Switch
                    checked={showPassword}
                    onChange={setShowPassword}
                    label={t('setup.showPassword')}
                  />
                  <PasswordState password={password} confirm={confirm} />
                </div>
              </>
            ) : null}

            {shown === 'brigade' ? (
              <>
                <section>
                  <SectionTitle>{t('setup.stationsHeading')}</SectionTitle>
                  <ul className="flex flex-col gap-2">
                    {stations.map((station, i) => (
                      <li key={station.key} className="flex gap-2">
                        <input
                          className="field"
                          aria-label={t('setup.stationsHeading')}
                          value={station.name}
                          onChange={(e) =>
                            changeStations(
                              stations.map((s) =>
                                s.key === station.key ? { ...s, name: e.target.value } : s,
                              ),
                            )
                          }
                          placeholder={t('stations.placeholder')}
                          autoFocus={i === 0 && editedStations === null}
                        />
                        <button
                          type="button"
                          className="btn-small shrink-0"
                          onClick={() =>
                            changeStations(stations.filter((s) => s.key !== station.key))
                          }
                        >
                          {t('common.remove')}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <AddStation
                    onAdd={(name) => changeStations([...stations, { key: newKey(), name }])}
                  />
                </section>

                <section className="border-rule border-t pt-6">
                  <SectionTitle>{t('setup.staffHeading')}</SectionTitle>
                  <p className="text-ink-soft -mt-1 mb-4 text-sm text-pretty">
                    {t('setup.staffBody')}
                  </p>
                  {staff.length === 0 ? (
                    <p className="text-ink-faint mb-4 text-sm">{t('setup.staffEmpty')}</p>
                  ) : (
                    <ul className="mb-4 flex flex-col gap-3">
                      {staff.map((person) => (
                        <PersonRow
                          key={person.key}
                          person={person}
                          stations={stations}
                          onChange={(next) =>
                            setStaff((rows) =>
                              rows.map((row) => (row.key === next.key ? next : row)),
                            )
                          }
                          onRemove={() =>
                            setStaff((rows) => rows.filter((row) => row.key !== person.key))
                          }
                        />
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="btn-small"
                    onClick={() =>
                      setStaff((rows) => [
                        ...rows,
                        { key: newKey(), displayName: '', role: 'cook', stationKey: '', pin: '' },
                      ])
                    }
                  >
                    {t('setup.addPerson')}
                  </button>
                </section>
              </>
            ) : null}

            {shown === 'recipes' ? (
              <section>
                {recipes.length === 0 ? (
                  <p className="text-ink-faint mb-4 text-sm">{t('setup.recipesEmpty')}</p>
                ) : (
                  <ul className="mb-4 flex flex-col gap-3">
                    {recipes.map((recipe) => (
                      <RecipeRow
                        key={recipe.key}
                        recipe={recipe}
                        stations={stations}
                        onChange={(next) =>
                          setRecipes((rows) =>
                            rows.map((row) => (row.key === next.key ? next : row)),
                          )
                        }
                        onRemove={() =>
                          setRecipes((rows) => rows.filter((row) => row.key !== recipe.key))
                        }
                      />
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  className="btn-small"
                  onClick={() =>
                    setRecipes((rows) => [
                      ...rows,
                      {
                        key: newKey(),
                        name: '',
                        type: 'dish',
                        stationKey: '',
                        yieldValue: '',
                        yieldUnit: 'each',
                      },
                    ])
                  }
                >
                  {t('setup.addRecipe')}
                </button>
              </section>
            ) : null}

            {shown === 'settings' ? (
              <>
                <fieldset className="flex flex-col gap-2">
                  <legend className="label">{t('kitchen.retention')}</legend>
                  <Choice
                    name="retention"
                    checked={tickedRetention === 'keep'}
                    onChange={() => setTickedRetention('keep')}
                    title={t('kitchen.retentionKeep')}
                  />
                  <Choice
                    name="retention"
                    checked={tickedRetention === 'delete'}
                    onChange={() => setTickedRetention('delete')}
                    title={t('kitchen.retentionDelete')}
                  />
                  <p className="text-ink-soft text-sm text-pretty">{t('kitchen.retentionHint')}</p>
                </fieldset>

                <Field label={t('kitchen.units')} htmlFor="units" hint={t('kitchen.unitsHint')}>
                  <select
                    id="units"
                    className="field"
                    value={unitSystem}
                    onChange={(e) => setUnitSystem(e.target.value as 'metric' | 'imperial')}
                  >
                    <option value="metric">{t('kitchen.metric')}</option>
                    <option value="imperial">{t('kitchen.imperial')}</option>
                  </select>
                </Field>

                <section className="border-rule flex flex-col gap-3 border-t pt-6">
                  <SectionTitle>{t('setup.thisDevice')}</SectionTitle>
                  <Switch
                    checked={enrolDevice}
                    onChange={setEnrolDevice}
                    label={t('setup.enrolDevice')}
                  />
                  <p className="text-ink-soft text-sm text-pretty">{t('setup.enrolHint')}</p>
                  {enrolDevice ? (
                    <div className="fade-swap">
                      <Field label={t('setup.deviceName')} htmlFor="deviceName">
                        <input
                          id="deviceName"
                          className="field"
                          value={deviceName}
                          onChange={(e) => setDeviceName(e.target.value)}
                          placeholder={t('devices.placeholder')}
                        />
                      </Field>
                    </div>
                  ) : null}
                </section>
              </>
            ) : null}

            {shown === 'check' ? (
              <Plate className="bg-surface-raised">
                <dl className="divide-line divide-y">
                  <Summary title={t('setup.stepKitchen')} onEdit={() => goTo(0)}>
                    <p>{kitchenName.trim()}</p>
                    <p className="text-ink-soft text-sm">{LANGUAGE_NAMES[language]}</p>
                  </Summary>
                  <Summary title={t('setup.stepYou')} onEdit={() => goTo(1)}>
                    <p>{t('setup.summaryAdmin', { name: displayName.trim() })}</p>
                    <p className="text-ink-soft text-sm">{email.trim()}</p>
                  </Summary>
                  <Summary title={t('setup.stationsHeading')} onEdit={() => goTo(2)}>
                    <p>{stations.map((station) => station.name.trim()).join(', ')}</p>
                  </Summary>
                  <Summary title={t('setup.staffHeading')} onEdit={() => goTo(2)}>
                    {staff.length === 0 ? (
                      <p className="text-ink-soft">{t('setup.summaryNone')}</p>
                    ) : (
                      <ul>
                        {staff.map((person) => (
                          <li key={person.key}>
                            {person.displayName.trim()}
                            <span className="text-ink-soft">
                              {' · '}
                              {roleName(t, person.role)}
                              {person.stationKey
                                ? ` · ${stations.find((s) => s.key === person.stationKey)?.name ?? ''}`
                                : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Summary>
                  <Summary title={t('setup.stepRecipes')} onEdit={() => goTo(3)}>
                    {recipes.length === 0 ? (
                      <p className="text-ink-soft">{t('setup.summaryNone')}</p>
                    ) : (
                      <ul>
                        {recipes.map((recipe) => (
                          <li key={recipe.key}>
                            {recipe.name.trim()}
                            <span className="text-ink-soft">
                              {' · '}
                              {t(`recipeType.${recipe.type}`)}
                              {` · ${recipe.yieldValue} ${recipe.yieldUnit}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Summary>
                  <Summary title={t('setup.stepSettings')} onEdit={() => goTo(4)}>
                    <p>
                      {t(
                        tickedRetention === 'delete'
                          ? 'kitchen.retentionDelete'
                          : 'kitchen.retentionKeep',
                      )}
                    </p>
                    <p className="text-ink-soft text-sm">
                      {t(unitSystem === 'metric' ? 'kitchen.metric' : 'kitchen.imperial')}
                    </p>
                    <p className="text-ink-soft text-sm">
                      {enrolDevice
                        ? t('setup.summaryTablet', { name: deviceName.trim() })
                        : t('setup.summaryNoTablet')}
                    </p>
                  </Summary>
                </dl>
              </Plate>
            ) : null}

            {problems.length > 0 ? (
              <ul
                role="alert"
                className="fade-swap border-danger text-danger flex flex-col gap-1 border-l-2 pl-3 text-sm"
              >
                {problems.map((problem) => (
                  <li key={problem}>{t(problem)}</li>
                ))}
              </ul>
            ) : null}

            {askForCode && shown === 'check' ? (
              <Field label={t('setup.codeLabel')} htmlFor="setupCode" hint={t('setup.codeHint')}>
                <input
                  id="setupCode"
                  className="field font-mono"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
            ) : null}

            {setup.error && shown === 'check' ? (
              <p role="alert" className="border-danger text-danger border-l-2 pl-3 text-sm">
                {setup.error instanceof RequestFailed
                  ? errorMessage(translator, setup.error)
                  : t('setup.failed')}
              </p>
            ) : null}
          </div>
        </>
      )}
    </SetupFrame>
  );
}

// --- pieces ------------------------------------------------------------------

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-ink font-display mb-3 text-[19px] font-semibold tracking-[0.08em] uppercase">
      {children}
    </h2>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="text-ink-soft mt-1.5 text-sm">{hint}</p> : null}
    </div>
  );
}

/** A visible on/off switch, square to match the rest of the kitchen. */
function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="text-ink inline-flex min-h-11 items-center gap-3 text-left font-medium"
    >
      <span
        aria-hidden
        className={`relative inline-block h-7 w-12 shrink-0 border-2 transition-colors ${
          checked ? 'border-accent bg-accent' : 'border-field bg-surface-sunk'
        }`}
      >
        <span
          className={`absolute top-[3px] h-[18px] w-[18px] transition-all ${
            checked ? 'bg-accent-ink left-[23px]' : 'bg-ink-soft left-[3px]'
          }`}
        />
      </span>
      {label}
    </button>
  );
}

function PasswordState({ password, confirm }: { password: string; confirm: string }) {
  const { t } = useT();
  if (password.length > 0 && password.length < MIN_PASSWORD) {
    return <p className="text-danger text-sm">{t('setup.passwordShort')}</p>;
  }
  if (!confirm) return null;
  return password === confirm ? (
    <p className="text-ink-soft text-sm">✓ {t('setup.passwordMatch')}</p>
  ) : (
    <p className="text-danger text-sm">{t('setup.passwordMismatch')}</p>
  );
}

function Choice({
  name,
  checked,
  onChange,
  title,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
}) {
  return (
    <label
      className={`flex min-h-12 cursor-pointer items-center gap-3 border-2 px-4 py-3 transition-colors ${
        checked
          ? 'border-accent bg-accent-wash'
          : 'border-line bg-surface-raised hover:border-field'
      }`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="accent-accent h-4 w-4 shrink-0"
      />
      <span className="font-medium">{title}</span>
    </label>
  );
}

function AddStation({ onAdd }: { onAdd: (name: string) => void }) {
  const { t } = useT();
  const [name, setName] = useState('');

  function add() {
    if (!name.trim()) return;
    onAdd(name.trim());
    setName('');
  }

  return (
    <div className="mt-3 flex gap-2">
      <input
        className="field"
        aria-label={t('stations.addLabel')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        // Enter adds the station rather than turning to the next page.
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        placeholder={t('stations.addLabel')}
      />
      <button type="button" className="btn-small shrink-0" onClick={add} disabled={!name.trim()}>
        {t('common.add')}
      </button>
    </div>
  );
}

function StationSelect({
  id,
  value,
  stations,
  onChange,
}: {
  id: string;
  value: string;
  stations: StationDraft[];
  onChange: (key: string) => void;
}) {
  const { t } = useT();
  return (
    <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t('staff.noStation')}</option>
      {stations
        .filter((station) => station.name.trim())
        .map((station) => (
          <option key={station.key} value={station.key}>
            {station.name}
          </option>
        ))}
    </select>
  );
}

function PersonRow({
  person,
  stations,
  onChange,
  onRemove,
}: {
  person: PersonDraft;
  stations: StationDraft[];
  onChange: (next: PersonDraft) => void;
  onRemove: () => void;
}) {
  const { t } = useT();
  const id = (field: string) => `${person.key}-${field}`;
  const pinWrong = person.pin.length > 0 && !PIN.test(person.pin);

  return (
    <li className="fade-swap border-rule bg-surface-raised grid gap-3 border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:p-4">
      <Field label={t('common.name')} htmlFor={id('name')}>
        <input
          id={id('name')}
          className="field"
          value={person.displayName}
          onChange={(e) => onChange({ ...person, displayName: e.target.value })}
          placeholder={t('staff.namePlaceholder')}
          autoFocus={!person.displayName}
        />
      </Field>
      <Field label={t('staff.role')} htmlFor={id('role')}>
        <select
          id={id('role')}
          className="field"
          value={person.role}
          onChange={(e) => onChange({ ...person, role: e.target.value as StaffRole })}
        >
          {[...ROLES]
            .reverse()
            .filter((role): role is StaffRole => role !== 'admin')
            .map((role) => (
              <option key={role} value={role}>
                {roleName(t, role)}
              </option>
            ))}
        </select>
      </Field>
      <Field label={t('staff.station')} htmlFor={id('station')}>
        <StationSelect
          id={id('station')}
          value={person.stationKey}
          stations={stations}
          onChange={(stationKey) => onChange({ ...person, stationKey })}
        />
      </Field>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label className="label" htmlFor={id('pin')}>
            {t('staff.pinTag')}
          </label>
          <input
            id={id('pin')}
            className="field"
            value={person.pin}
            onChange={(e) => onChange({ ...person, pin: e.target.value.replace(/\D/g, '') })}
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            placeholder={t('staff.pinPlaceholder')}
            aria-invalid={pinWrong}
          />
        </div>
        <button type="button" className="btn-small h-11 shrink-0" onClick={onRemove}>
          {t('common.remove')}
        </button>
      </div>
    </li>
  );
}

function RecipeRow({
  recipe,
  stations,
  onChange,
  onRemove,
}: {
  recipe: RecipeDraft;
  stations: StationDraft[];
  onChange: (next: RecipeDraft) => void;
  onRemove: () => void;
}) {
  const { t, plural } = useT();
  const id = (field: string) => `${recipe.key}-${field}`;

  return (
    <li className="fade-swap border-rule bg-surface-raised grid gap-3 border p-3 sm:grid-cols-2 sm:p-4">
      <div className="sm:col-span-2">
        <Field label={t('setup.recipeName')} htmlFor={id('name')}>
          <input
            id={id('name')}
            className="field"
            value={recipe.name}
            onChange={(e) => onChange({ ...recipe, name: e.target.value })}
            autoFocus={!recipe.name}
          />
        </Field>
      </div>
      <Field label={t('setup.recipeType')} htmlFor={id('type')}>
        <select
          id={id('type')}
          className="field"
          value={recipe.type}
          onChange={(e) => onChange({ ...recipe, type: e.target.value as RecipeType })}
        >
          {RECIPE_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`recipeType.${type}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('staff.station')} htmlFor={id('station')}>
        <StationSelect
          id={id('station')}
          value={recipe.stationKey}
          stations={stations}
          onChange={(stationKey) => onChange({ ...recipe, stationKey })}
        />
      </Field>
      <div className="flex items-end gap-2">
        {recipe.type === 'dish' ? (
          <p className="text-ink-soft min-w-0 flex-1 pb-3 text-sm">
            {plural('editor.dishPlates', ONE_PLATE.portions)}
          </p>
        ) : (
          <div className="min-w-0 flex-1">
            <label className="label" htmlFor={id('yield')}>
              {t('setup.makes')}
            </label>
            <div className="flex gap-2">
              <input
                id={id('yield')}
                className="field min-w-0"
                value={recipe.yieldValue}
                onChange={(e) => onChange({ ...recipe, yieldValue: e.target.value })}
                inputMode="decimal"
                placeholder="10"
              />
              <select
                aria-label={t('editor.yieldUnit')}
                className="field w-28 shrink-0"
                value={recipe.yieldUnit}
                onChange={(e) => onChange({ ...recipe, yieldUnit: e.target.value as UnitCode })}
              >
                {ALL_UNITS.map((unit) => (
                  <option key={unit.code} value={unit.code}>
                    {unit.code}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        <button type="button" className="btn-small h-11 shrink-0" onClick={onRemove}>
          {t('common.remove')}
        </button>
      </div>
    </li>
  );
}

function Summary({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  const { t } = useT();
  return (
    <div className="flex items-start gap-4 p-4 xl:p-5">
      <div className="min-w-0 flex-1">
        <dt className="text-ink-faint font-display mb-1 text-[11px] font-semibold tracking-[0.16em] uppercase xl:text-xs">
          {title}
        </dt>
        <dd>{children}</dd>
      </div>
      <button type="button" className="btn-small shrink-0" onClick={onEdit}>
        {t('common.edit')}
      </button>
    </div>
  );
}
