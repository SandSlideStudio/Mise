import { AboutLine } from '../components/AboutLine.js';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { AppShell, PageHeader } from '../components/AppShell.js';
import { useCurrentUser } from '../api/session.js';
import { useT, type MessageKey } from '../i18n/index.js';
import { StaffSettings } from './settings/StaffSettings.js';
import { StationSettings } from './settings/StationSettings.js';
import { DeviceSettings } from './settings/DeviceSettings.js';
import { OutsideDeviceSettings } from './settings/OutsideDeviceSettings.js';
import { KitchenSettings } from './settings/KitchenSettings.js';
import { BackupSettings } from './settings/BackupSettings.js';
import { ConnectionSettings } from './settings/ConnectionSettings.js';
import { ProxySettings } from './settings/ProxySettings.js';
import { HttpsSettings } from './settings/HttpsSettings.js';
import { PasswordOnly } from '../components/PasswordOnly.js';
import { useScrollFade } from '../lib/scrollFade.js';
import { DishCardSettings } from './settings/DishCardSettings.js';

type TabId = 'staff' | 'stations' | 'devices' | 'kitchen' | 'dishCards' | 'connection' | 'backups';

const TABS: { id: TabId; label: MessageKey; adminOnly?: boolean }[] = [
  { id: 'staff', label: 'settings.tabStaff' },
  { id: 'stations', label: 'settings.tabStations' },
  { id: 'devices', label: 'settings.tabDevices' },
  { id: 'kitchen', label: 'settings.tabKitchen' },
  { id: 'dishCards', label: 'settings.tabDishCards' },
  { id: 'connection', label: 'settings.tabConnection', adminOnly: true },
  { id: 'backups', label: 'settings.tabBackups', adminOnly: true },
];

/** Everything an administrator sets up once and then forgets about. */
export function Settings() {
  const { t } = useT();
  const { data: user } = useCurrentUser();
  const tabsRef = useScrollFade<HTMLDivElement>();
  const navigate = useNavigate();
  // The tab is in the address (/settings?tab=backups), so a link can open one
  // directly, a reload stays on it and Back steps between the tabs seen.
  const asked = (useSearch({ strict: false }) as { tab?: string }).tab;
  const tab: TabId = TABS.some(
    (entry) => entry.id === asked && (!entry.adminOnly || user?.role === 'admin'),
  )
    ? (asked as TabId)
    : 'staff';
  const setTab = (next: TabId) => void navigate({ to: '/settings', search: { tab: next } });

  if (!user) return null;

  if (user.role === 'cook') {
    return (
      <AppShell>
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-5 sm:py-10">
          <PageHeader title={t('nav.settings')} description={t('settings.cookOnly')} />
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-5 sm:py-10">
        <PageHeader title={t('nav.settings')} />

        <div
          ref={tabsRef}
          className="border-line mb-8 flex overflow-x-auto border-b"
          role="tablist"
        >
          {TABS.filter((entry) => !entry.adminOnly || user.role === 'admin').map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={`font-display -mb-px shrink-0 border-b-4 px-4 py-2.5 text-lg font-semibold transition-colors sm:px-5 ${
                tab === entry.id
                  ? 'border-accent text-ink'
                  : 'text-ink-soft hover:text-ink border-transparent'
              }`}
            >
              {t(entry.label)}
            </button>
          ))}
        </div>

        {tab === 'staff' ? (
          <PasswordOnly note="passwordOnly.staff">
            <StaffSettings />
          </PasswordOnly>
        ) : null}
        {tab === 'stations' ? <StationSettings /> : null}
        {tab === 'devices' ? (
          <PasswordOnly note="passwordOnly.devices">
            <DeviceSettings />
            <OutsideDeviceSettings />
          </PasswordOnly>
        ) : null}
        {tab === 'kitchen' ? <KitchenSettings /> : null}
        {tab === 'dishCards' ? <DishCardSettings /> : null}
        {tab === 'connection' && user.role === 'admin' ? (
          <PasswordOnly note="passwordOnly.connection">
            <ConnectionSettings />
            <HttpsSettings />
            <ProxySettings />
          </PasswordOnly>
        ) : null}
        {tab === 'backups' && user.role === 'admin' ? (
          <PasswordOnly note="passwordOnly.backups">
            <BackupSettings />
          </PasswordOnly>
        ) : null}

        <AboutLine className="border-line mt-12 border-t pt-4" />
      </main>
    </AppShell>
  );
}
