import { AboutLine } from '../components/AboutLine.js';
import { useState } from 'react';
import { AppShell, PageHeader } from '../components/AppShell.js';
import { useCurrentUser } from '../api/session.js';
import { useT, type MessageKey } from '../i18n/index.js';
import { StaffSettings } from './settings/StaffSettings.js';
import { StationSettings } from './settings/StationSettings.js';
import { DeviceSettings } from './settings/DeviceSettings.js';
import { KitchenSettings } from './settings/KitchenSettings.js';
import { BackupSettings } from './settings/BackupSettings.js';

type TabId = 'staff' | 'stations' | 'devices' | 'kitchen' | 'backups';

const TABS: { id: TabId; label: MessageKey; adminOnly?: boolean }[] = [
  { id: 'staff', label: 'settings.tabStaff' },
  { id: 'stations', label: 'settings.tabStations' },
  { id: 'devices', label: 'settings.tabDevices' },
  { id: 'kitchen', label: 'settings.tabKitchen' },
  { id: 'backups', label: 'settings.tabBackups', adminOnly: true },
];

/** A link such as the backup warning's can open a tab directly: /settings?tab=backups. */
function tabFromAddress(): TabId {
  const asked = new URLSearchParams(window.location.search).get('tab');
  return TABS.some((entry) => entry.id === asked) ? (asked as TabId) : 'staff';
}

/** Everything an administrator sets up once and then forgets about. */
export function Settings() {
  const { t } = useT();
  const { data: user } = useCurrentUser();
  const [tab, setTab] = useState<TabId>(tabFromAddress);

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

        <div className="border-line mb-8 flex overflow-x-auto border-b" role="tablist">
          {TABS.filter((entry) => !entry.adminOnly || user.role === 'admin').map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={`font-display -mb-px shrink-0 border-b-4 px-4 py-2.5 text-lg font-semibold tracking-[0.1em] uppercase transition-colors sm:px-5 ${
                tab === entry.id
                  ? 'border-accent text-ink'
                  : 'text-ink-soft hover:text-ink border-transparent'
              }`}
            >
              {t(entry.label)}
            </button>
          ))}
        </div>

        {tab === 'staff' ? <StaffSettings /> : null}
        {tab === 'stations' ? <StationSettings /> : null}
        {tab === 'devices' ? <DeviceSettings /> : null}
        {tab === 'kitchen' ? <KitchenSettings /> : null}
        {tab === 'backups' && user.role === 'admin' ? <BackupSettings /> : null}

        <AboutLine className="border-line mt-12 border-t pt-4" />
      </main>
    </AppShell>
  );
}
