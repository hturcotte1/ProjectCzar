import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { MeResponse, RoomSummary } from '../shared/app-types';
import { api, onSignedOut, setCsrfToken } from './lib/api';
import { live, useLive, useLiveStatus } from './lib/live';
import { MeContext } from './lib/me';
import { linkProps, match, navigate, usePath } from './lib/router';
import { Light } from './components/ui';
import { LoginPage } from './screens/auth/LoginPage';
import { InvitePage } from './screens/auth/InvitePage';
import { RoomPage } from './screens/room/RoomPage';
import { AgentsPage } from './screens/agents/AgentsPage';
import { AgentDetailPage } from './screens/agents/AgentDetailPage';
import { SettingsPage } from './screens/settings/SettingsPage';
import { AlertsPage } from './screens/alerts/AlertsPage';

export function App() {
  const path = usePath();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [state, setState] = useState<'loading' | 'signed-out' | 'ready'>('loading');

  const load = useCallback(async () => {
    try {
      const m = await api.get<MeResponse>('/me');
      setCsrfToken(m.csrf_token);
      setMe(m);
      setState('ready');
    } catch {
      setState('signed-out');
    }
  }, []);

  useEffect(() => {
    void load();
    return onSignedOut(() => {
      setMe(null);
      setState('signed-out');
      live.stop();
    });
  }, [load]);

  useEffect(() => {
    if (state === 'ready') live.start();
  }, [state]);

  const signedIn = (m: MeResponse) => {
    setCsrfToken(m.csrf_token);
    setMe(m);
    setState('ready');
    navigate(m.rooms.length ? `/rooms/${m.rooms[0].id}` : '/', { replace: true });
  };

  const invite = match('/invite/:token', path);
  if (invite) return <InvitePage token={invite.token} onSignedIn={signedIn} />;
  if (state === 'loading') return <div className="auth-wrap muted">Loading Tempo…</div>;
  if (state === 'signed-out' || !me) return <LoginPage onSignedIn={signedIn} />;

  return (
    <MeContext.Provider value={{ me, refresh: load }}>
      <Shell me={me} path={path} reload={load} />
    </MeContext.Provider>
  );
}

function Shell({ me, path, reload }: { me: MeResponse; path: string; reload: () => Promise<void> }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [rooms, setRooms] = useState<RoomSummary[]>(me.rooms);
  const [unread, setUnread] = useState(me.unread_alerts);
  const status = useLiveStatus();
  useEffect(() => setRooms(me.rooms), [me.rooms]);
  useEffect(() => setUnread(me.unread_alerts), [me.unread_alerts]);
  useEffect(() => setMenuOpen(false), [path]);

  const refreshRooms = useCallback(async () => {
    try {
      setRooms(await api.get<RoomSummary[]>('/rooms'));
    } catch {
      /* shown elsewhere */
    }
  }, []);

  useLive((e) => {
    if (e.type === 'rooms' || e.type === 'agent' || e.type === 'decision' || (e.type === 'room' && e.what !== 'playbook') || e.type === 'poll' || e.type === 'reconnected') {
      void refreshRooms();
    }
    if (e.type === 'alert') setUnread((n) => n + 1);
    if (e.type === 'rooms') void reload();
  });

  const roomMatch = match('/rooms/:id/:tab?', path);
  const agentMatch = match('/agents/:id', path);

  let content: ReactNode;
  if (roomMatch) content = <RoomPage key={roomMatch.id} roomId={roomMatch.id} tab={roomMatch.tab ?? 'feed'} onMenu={() => setMenuOpen(true)} />;
  else if (path === '/agents') content = <Page title="Agents" onMenu={() => setMenuOpen(true)}><AgentsPage /></Page>;
  else if (agentMatch) content = <Page title="Agent" onMenu={() => setMenuOpen(true)}><AgentDetailPage agentId={agentMatch.id} /></Page>;
  else if (path.startsWith('/settings')) content = <Page title="Settings" onMenu={() => setMenuOpen(true)}><SettingsPage /></Page>;
  else if (path === '/alerts') content = <Page title="Alerts" onMenu={() => setMenuOpen(true)}><AlertsPage /></Page>;
  else content = <Home rooms={rooms} onMenu={() => setMenuOpen(true)} />;

  return (
    <div className="shell">
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
      <nav className={`sidebar${menuOpen ? ' open' : ''}`} aria-label="Rooms and pages">
        <div className="sidebar-head">
          <a className="brand" {...linkProps('/')}>
            <span className="brand-mark" aria-hidden="true" /> Tempo
          </a>
          <span
            className="connection-dot"
            style={{ marginLeft: 'auto', background: status === 'live' ? 'var(--green)' : status === 'polling' ? 'var(--amber)' : 'var(--gray)' }}
            title={status === 'live' ? 'Live updates on' : status === 'polling' ? 'Live updates unavailable: refreshing every few seconds' : 'Connecting…'}
          />
        </div>
        <div className="sidebar-section">
          <h4>Rooms</h4>
          {rooms.length === 0 && <div className="faint small" style={{ padding: '4px 10px' }}>No rooms yet.</div>}
          {rooms.map((r) => (
            <a key={r.id} className={`nav-item${roomMatch?.id === r.id ? ' active' : ''}`} {...linkProps(`/rooms/${r.id}`)}>
              <Light light={r.paused ? 'gray' : r.status} />
              <span className="truncate">{r.name}</span>
              {r.is_sandbox && <span className="pill">sandbox</span>}
              {r.decisions_waiting > 0 && <span className="count" title="Waiting on a person">{r.decisions_waiting}</span>}
            </a>
          ))}
          <a className="nav-item faint" {...linkProps('/?new=room')}>
            + New room
          </a>
        </div>
        <div className="sidebar-section">
          <h4>You</h4>
          <a className={`nav-item${path.startsWith('/agents') ? ' active' : ''}`} {...linkProps('/agents')}>
            Agents
          </a>
          <a className={`nav-item${path === '/alerts' ? ' active' : ''}`} {...linkProps('/alerts')}>
            Alerts {unread > 0 && <span className="count">{unread}</span>}
          </a>
          <a className={`nav-item${path.startsWith('/settings') ? ' active' : ''}`} {...linkProps('/settings')}>
            Settings
          </a>
        </div>
        <div className="sidebar-foot">
          <div className="row-between small">
            <span className="truncate">{me.person.name}</span>
            <ThemeToggle />
          </div>
        </div>
      </nav>
      <div className="main">{content}</div>
    </div>
  );
}

export function TopBar({ title, children, onMenu }: { title: ReactNode; children?: ReactNode; onMenu: () => void }) {
  return (
    <header className="topbar">
      <button type="button" className="btn btn-ghost menu-button" onClick={onMenu} aria-label="Open the room list">
        ☰
      </button>
      <h1 className="truncate">{title}</h1>
      <div className="spacer" />
      {children}
    </header>
  );
}

function Page({ title, children, onMenu }: { title: string; children: ReactNode; onMenu: () => void }) {
  return (
    <>
      <TopBar title={title} onMenu={onMenu} />
      <div className="page">
        <div className="page-narrow">{children}</div>
      </div>
    </>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<string>(() => document.documentElement.dataset.theme ?? 'system');
  const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      title="Switch between system, light and dark themes"
      onClick={() => {
        if (next === 'system') delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem('tempo-theme', next);
        } catch {
          /* ignore */
        }
        setTheme(next);
      }}
    >
      Theme: {theme}
    </button>
  );
}

function Home({ rooms, onMenu }: { rooms: RoomSummary[]; onMenu: () => void }) {
  const wantsNew = new URLSearchParams(window.location.search).get('new') === 'room';
  useEffect(() => {
    if (!wantsNew && rooms.length) navigate(`/rooms/${rooms[0].id}`, { replace: true });
  }, [rooms, wantsNew]);
  return (
    <Page title={wantsNew || !rooms.length ? 'New room' : 'Tempo'} onMenu={onMenu}>
      <NewRoom />
    </Page>
  );
}

function NewRoom() {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const room = await api.post<{ id: string }>('/rooms', { name, goal });
          window.location.assign(`/rooms/${room.id}`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="muted">A room is one shared project. Agents in the room report here, talk to each other and take direction.</p>
      {error && <div className="banner banner-error">{error}</div>}
      <div className="field">
        <label htmlFor="room-name">Room name</label>
        <input id="room-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="Launch" />
      </div>
      <div className="field">
        <label htmlFor="room-goal">Goal</label>
        <textarea id="room-goal" className="textarea" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What should the agents achieve together?" />
        <span className="hint">You can change it any time. The Conductor turns it into next steps for each agent.</span>
      </div>
      <div>
        <button className="btn btn-primary" disabled={busy || !name.trim()}>
          Create room
        </button>
      </div>
    </form>
  );
}
