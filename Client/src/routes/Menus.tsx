import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import type { MenuStatus } from '@mise/contracts';
import { useCreateMenu, useMenus } from '../api/menus.js';
import { useCurrentUser } from '../api/session.js';
import { AppShell, PageHeader } from '../components/AppShell.js';
import { LoadError } from '../components/LoadError.js';
import { Plate } from '../components/Plate.js';
import { errorMessage, useT, type MessageKey } from '../i18n/index.js';

/**
 * Menus: what front of house sells together. The active ones first, because
 * that is what the floor is serving tonight.
 */

const STATUS_ORDER: MenuStatus[] = ['active', 'draft', 'archived'];

export function menuStatusName(t: (key: MessageKey) => string, status: MenuStatus): string {
  return t(`menuStatus.${status}` as MessageKey);
}

export function Menus() {
  const translator = useT();
  const { t, plural } = translator;
  const { data: user } = useCurrentUser();
  const menus = useMenus();
  const create = useCreateMenu();
  const navigate = useNavigate();
  const [name, setName] = useState('');

  if (!user) return null;
  const canManage = user.role !== 'cook';

  function onCreate(event: FormEvent) {
    event.preventDefault();
    create.mutate(
      { name },
      { onSuccess: (menu) => void navigate({ to: '/menus/$menuId', params: { menuId: menu.id } }) },
    );
  }

  const sorted = [...(menus.data ?? [])].sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      a.name.localeCompare(b.name),
  );

  return (
    <AppShell>
      <main className="mx-auto max-w-[1000px] px-4 py-6 sm:px-6 sm:py-8">
        <PageHeader title={t('nav.menus')} description={t('menus.subtitle')} />

        {canManage ? (
          <form onSubmit={onCreate} className="mb-6 flex flex-wrap gap-2.5">
            <input
              aria-label={t('menus.name')}
              className="field min-w-[220px] flex-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('menus.namePlaceholder')}
              maxLength={120}
              required
            />
            <button type="submit" className="btn-primary min-h-11" disabled={create.isPending}>
              {t('menus.new')}
            </button>
            {create.error ? (
              <p role="alert" className="text-danger w-full text-sm">
                {errorMessage(translator, create.error)}
              </p>
            ) : null}
          </form>
        ) : null}

        {menus.isPending ? <p className="text-ink-soft">{t('common.loading')}</p> : null}
        {menus.isError ? <LoadError onRetry={() => void menus.refetch()} /> : null}
        {menus.data?.length === 0 ? (
          <p className="text-ink-soft border-line border-2 border-dashed p-8 text-center text-lg">
            {t('menus.empty')}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          {sorted.map((menu) => (
            <Link
              key={menu.id}
              to="/menus/$menuId"
              params={{ menuId: menu.id }}
              className="block transition-transform hover:-translate-y-0.5"
            >
              <Plate className="bg-surface-raised h-full px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-[26px] leading-tight">{menu.name}</h2>
                  <span
                    className={`tag shrink-0 text-[12px] ${
                      menu.status === 'active'
                        ? 'tag-brand'
                        : menu.status === 'draft'
                          ? 'tag-accent'
                          : ''
                    }`}
                  >
                    {menuStatusName(t, menu.status)}
                  </span>
                </div>
                {menu.description ? (
                  <p className="text-ink-soft mt-1 line-clamp-2">{menu.description}</p>
                ) : null}
                <p className="text-ink-soft mt-2 text-sm">
                  {plural('menus.dishes', menu.dishCount)}
                </p>
              </Plate>
            </Link>
          ))}
        </div>
      </main>
    </AppShell>
  );
}
