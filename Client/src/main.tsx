import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RequestFailed } from './api/client.js';
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  RouterProvider,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import { useEffect } from 'react';
import { useLiveUpdates } from './api/live.js';
import { useTickSender } from './api/ticks.js';
import { useCurrentUser, useSetupStatus } from './api/session.js';
import { I18nProvider, useT } from './i18n/index.js';
import { Ingredients } from './routes/Ingredients.js';
import { RecipeEditor } from './routes/RecipeEditor.js';
import { RecipeView } from './routes/RecipeView.js';
import { Recipes } from './routes/Recipes.js';
import { Today } from './routes/Today.js';
import { Line } from './routes/Line.js';
import { Login } from './routes/Login.js';
import { Settings } from './routes/Settings.js';
import { Setup } from './routes/Setup.js';
import { applyTheme } from './lib/theme.js';
import { TourHost } from './components/Tour.js';
// Self-hosted, so a kitchen server with no internet still draws its own type.
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import './styles.css';

applyTheme();

/** A 401 from anything means the session ended: show the sign-in screen. */
function signedOutElsewhere(error: unknown): void {
  if (error instanceof RequestFailed && error.isUnauthenticated) {
    queryClient.setQueryData(['me'], null);
  }
}

/** How often a screen that can't reach the server tries again. */
const RECONNECT_MS = 5_000;

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: signedOutElsewhere }),
  mutationCache: new MutationCache({ onError: signedOutElsewhere }),
  defaultOptions: {
    queries: {
      // A kitchen tablet sits on a counter for hours; refetching on focus keeps
      // the prep list honest without anyone reaching for reload.
      refetchOnWindowFocus: true,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

/**
 * Decides what an arriving browser should see: the first-run page on an empty
 * server, the sign-in page when nobody is signed in, and the app otherwise.
 */
function Shell() {
  const navigate = useNavigate();
  const { t } = useT();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const setupStatus = useSetupStatus();
  const currentUser = useCurrentUser();

  const needsSetup = setupStatus.data?.needsSetup === true;
  // Only a real "nobody is signed in" counts. A server error is not a sign-out.
  const signedOut = currentUser.isSuccess && currentUser.data === null;
  // Only when there's nothing to show yet; a failed background refresh keeps the screen.
  const unreachable =
    (setupStatus.isError && setupStatus.data === undefined) ||
    (currentUser.isError && currentUser.data === undefined);
  const isPublicRoute = pathname === '/login' || pathname === '/line' || pathname === '/setup';

  useEffect(() => {
    if (!unreachable) return;
    const timer = window.setInterval(() => {
      void setupStatus.refetch();
      void currentUser.refetch();
    }, RECONNECT_MS);
    return () => window.clearInterval(timer);
  }, [unreachable, setupStatus, currentUser]);

  useLiveUpdates(currentUser.data != null);
  // Saved ticks keep being sent whichever screen is open.
  useTickSender();

  useEffect(() => {
    if (setupStatus.isPending) return;

    if (needsSetup && pathname !== '/setup') {
      void navigate({ to: '/setup', replace: true });
      return;
    }
    if (!needsSetup && pathname === '/setup') {
      // Whoever just finished setting up is already signed in.
      void navigate({ to: signedOut ? '/login' : '/', replace: true });
      return;
    }
    if (!needsSetup && signedOut && !isPublicRoute) {
      void navigate({ to: '/login', replace: true });
    }
  }, [needsSetup, signedOut, pathname, isPublicRoute, setupStatus.isPending, navigate]);

  if (setupStatus.isPending || currentUser.isPending) {
    return (
      <div className="text-ink-soft flex min-h-dvh items-center justify-center">
        {t('common.loading')}
      </div>
    );
  }

  if (unreachable) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-5 text-center">
        <h1 className="text-[32px]">{t('shell.unreachableTitle')}</h1>
        <p className="text-ink-soft mt-2">{t('shell.unreachableBody')}</p>
        <button
          type="button"
          className="btn-quiet mt-6"
          onClick={() => {
            void setupStatus.refetch();
            void currentUser.refetch();
          }}
        >
          {t('common.tryAgain')}
        </button>
      </div>
    );
  }

  // The tour lives here rather than in each page, so it keeps its place while
  // it walks from one page to the next. Keyed by person: a cook signing in
  // after someone else gets their own question.
  const inApp = !needsSetup && !isPublicRoute && currentUser.data != null;

  return (
    <>
      <Outlet />
      {inApp ? <TourHost key={currentUser.data!.id} /> : null}
    </>
  );
}

const rootRoute = createRootRoute({ component: Shell });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: Today }),
  createRoute({ getParentRoute: () => rootRoute, path: '/recipes', component: Recipes }),
  createRoute({ getParentRoute: () => rootRoute, path: '/recipes/new', component: RecipeEditor }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/recipes/$recipeId',
    component: RecipeView,
    // A prep line opens its spec at the amount it asks for: ?amount=2000&unit=g.
    validateSearch: (search: Record<string, unknown>): { amount?: number; unit?: string } => {
      const amount = Number(search.amount);
      return {
        amount: Number.isFinite(amount) && amount > 0 ? amount : undefined,
        unit: typeof search.unit === 'string' ? search.unit : undefined,
      };
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/recipes/$recipeId/edit',
    component: RecipeEditor,
  }),
  // Loaded when first opened: the fonts and PDF code are only needed here.
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/recipes/$recipeId/card',
    component: lazyRouteComponent(() => import('./routes/DishCard.js'), 'DishCardPage'),
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/ingredients', component: Ingredients }),
  createRoute({ getParentRoute: () => rootRoute, path: '/setup', component: Setup }),
  createRoute({ getParentRoute: () => rootRoute, path: '/login', component: Login }),
  createRoute({ getParentRoute: () => rootRoute, path: '/line', component: Line }),
  createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: Settings }),
]);

// No view transitions: where the browser can't run one (a dimmed or covered
// tablet), it aborts it and the page change never finishes. Pages animate in
// with plain CSS instead; see .app-main in styles.css.
const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element');

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
