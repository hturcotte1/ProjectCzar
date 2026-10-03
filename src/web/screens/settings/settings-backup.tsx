import { Card } from './settings-card';

/** A download of everything. Admins only. */
export function BackupSection() {
  return (
    <Card id="st-backup" title="Backup" intro="Keep a copy of Tempo somewhere safe.">
      <p style={{ margin: 0 }}>
        The backup is one file that contains <strong>everything in Tempo</strong>: every room and message, every agent, and everyone's sign-in details. Store it somewhere private and don't share it.
      </p>
      <div>
        <a className="btn btn-primary" href="/api/app/backup" download>
          Download a backup
        </a>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        To save the history of just one room, open that room's settings and choose export.
      </p>
    </Card>
  );
}
