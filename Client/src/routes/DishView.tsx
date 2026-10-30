import { Link, useParams } from '@tanstack/react-router';
import { RequestFailed } from '../api/client.js';
import { useDishCard } from '../api/dishcards.js';
import { useCurrentUser } from '../api/session.js';
import { AppShell } from '../components/AppShell.js';
import { DishCardView } from '../components/DishCardView.js';
import { LoadError } from '../components/LoadError.js';
import { useT } from '../i18n/index.js';

/**
 * One dish, as its card: front and back on one page, with the way to its spec,
 * to the editor and to the printable card. Opening it follows the same rule
 * as opening the printable card.
 */
export function DishView() {
  const { t } = useT();
  const { dishId } = useParams({ strict: false }) as { dishId: string };
  const { data: user } = useCurrentUser();
  const card = useDishCard(dishId);

  if (!user) return null;
  const canManage = user.role !== 'cook';
  const kept = card.error instanceof RequestFailed && card.error.status === 403;
  const broken = card.error instanceof RequestFailed && card.error.status === 422;

  return (
    <AppShell>
      <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link to="/dishes" className="eyebrow">
            ← {t('nav.dishes')}
          </Link>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/recipes/$recipeId"
              params={{ recipeId: dishId }}
              className="btn-quiet min-h-11"
            >
              {t('dishes.openSpec')}
            </Link>
            {canManage ? (
              <Link
                to="/recipes/$recipeId/edit"
                params={{ recipeId: dishId }}
                className="btn-quiet min-h-11"
              >
                {t('common.edit')}
              </Link>
            ) : null}
            {card.data ? (
              <Link
                to="/recipes/$recipeId/card"
                params={{ recipeId: dishId }}
                className="btn-primary min-h-11"
              >
                {t('dishes.print')}
              </Link>
            ) : null}
          </div>
        </div>

        {card.isPending ? <p className="text-ink-soft">{t('common.loading')}</p> : null}
        {kept ? <p className="text-ink-soft text-lg">{t('dishes.kept')}</p> : null}
        {broken ? <p className="text-danger text-lg">{t('dishes.broken')}</p> : null}
        {card.isError && !kept && !broken ? (
          <LoadError onRetry={() => void card.refetch()} />
        ) : null}
        {card.data ? <DishCardView card={card.data} /> : null}
      </main>
    </AppShell>
  );
}
