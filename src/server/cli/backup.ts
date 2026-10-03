import path from 'node:path';
import { DateTime } from 'luxon';
import { createContext } from '../app.js';
import { loadDotEnvIfPresent } from '../config.js';
import { writeBackup } from '../services/backup.js';

/**
 * `npm run backup`: writes a consistent copy of the database right now, next to the nightly ones
 * (DATA_DIR/backups/tempo-manual-<date>-<time>.db). Safe while Tempo is running. Pass a file path
 * to write somewhere else: `npm run backup -- /path/to/copy.db`. Manual copies are never pruned.
 */
async function main(): Promise<void> {
  loadDotEnvIfPresent();
  const ctx = createContext({});
  const stamp = DateTime.now().setZone(ctx.config.defaultTimezone).toFormat('yyyy-LL-dd-HHmmss');
  const target = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ctx.config.backupDir, `tempo-manual-${stamp}.db`);
  const file = await writeBackup(ctx, target);
  ctx.db.close();
  console.log(`Backup written: ${file}`);
  console.log('To restore it later: stop Tempo, replace the database file with this copy, and start Tempo again.');
}

main().catch((e) => {
  console.error(`Backup failed: ${(e as Error).message}`);
  process.exit(1);
});
