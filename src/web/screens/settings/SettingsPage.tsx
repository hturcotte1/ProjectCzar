import type { ReactNode } from 'react';
import { useMe } from '../../lib/me';
import { linkProps, usePath } from '../../lib/router';
import { ActivitySection } from './settings-activity';
import { BackupSection } from './settings-backup';
import { PeopleSection } from './settings-people';
import { YouSection } from './settings-you';
import './settings.css';

type TabId = 'you' | 'people' | 'activity' | 'backup';

const TABS: { id: TabId; label: string; path: string; adminOnly?: boolean; render: () => ReactNode }[] = [
  { id: 'you', label: 'You', path: '/settings', render: () => <YouSection /> },
  { id: 'people', label: 'People', path: '/settings/people', adminOnly: true, render: () => <PeopleSection /> },
  { id: 'activity', label: 'Activity', path: '/settings/activity', render: () => <ActivitySection /> },
  { id: 'backup', label: 'Backup', path: '/settings/backup', adminOnly: true, render: () => <BackupSection /> },
];

/** Settings. Each tab has its own address, so a refresh or a shared link lands in the same place. */
export function SettingsPage() {
  const { me } = useMe();
  const path = usePath().replace(/\/+$/, '') || '/';
  const isAdmin = me.person.role === 'admin';
  const visible = TABS.filter((t) => isAdmin || !t.adminOnly);
  const current = visible.find((t) => t.path === path) ?? visible[0];

  return (
    <div className="stack st-page">
      <nav className="tabs st-tabs" aria-label="Settings sections">
        {visible.map((t) => (
          <a key={t.id} className={`tab${t === current ? ' active' : ''}`} aria-current={t === current ? 'page' : undefined} {...linkProps(t.path)}>
            {t.label}
          </a>
        ))}
      </nav>
      {current.render()}
    </div>
  );
}
