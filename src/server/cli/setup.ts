import readline from 'node:readline';
import { Writable } from 'node:stream';
import { createContext } from '../app.js';
import { loadDotEnvIfPresent } from '../config.js';
import { createPerson, MIN_PASSWORD } from '../services/auth.js';
import { audit } from '../services/audit.js';
import { isTempoError } from '../lib/errors.js';

/**
 * `npm run setup`: creates the first admin by asking for a name, email and password.
 * Non-interactive use (for a hosted server): TEMPO_ADMIN_NAME and TEMPO_ADMIN_EMAIL as variables
 * and the password on standard input with --password-stdin.
 */

function ask(question: string, hidden = false): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY ?? false });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
    muted = hidden && !!process.stdin.isTTY;
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

async function main(): Promise<void> {
  loadDotEnvIfPresent();
  const ctx = createContext();
  const admins = (ctx.db.prepare("SELECT COUNT(*) AS n FROM people WHERE role = 'admin' AND disabled_at IS NULL").get() as { n: number }).n;
  if (admins > 0 && !process.argv.includes('--another-admin')) {
    console.log('Tempo already has an admin. Sign in and invite people from Settings → People.');
    console.log('(To add another admin from here anyway, run: npm run setup -- --another-admin)');
    return;
  }
  console.log('Create the first Tempo admin.\n');
  const fromStdin = process.argv.includes('--password-stdin');
  const name = process.env.TEMPO_ADMIN_NAME?.trim() || (await ask('Your name: '));
  const email = process.env.TEMPO_ADMIN_EMAIL?.trim() || (await ask('Your email: '));
  let password: string;
  if (fromStdin) {
    password = await readStdin();
  } else {
    password = await ask(`Choose a password (at least ${MIN_PASSWORD} characters; it won't show as you type): `, true);
    const again = await ask('Type the password again: ', true);
    if (again !== password) {
      console.error('The two passwords are different. Nothing was created; run npm run setup again.');
      process.exitCode = 1;
      return;
    }
  }
  try {
    const person = await createPerson(ctx, { name, email, password, role: 'admin' });
    audit(ctx, { kind: 'system', id: null, name: 'setup' }, 'person.create_admin', 'person', person.id, null, { email: person.email });
    console.log(`\nDone. ${person.name} (${person.email}) is an admin. Start Tempo with "npm start" and sign in at ${ctx.config.baseUrl}`);
  } catch (e) {
    console.error(isTempoError(e) ? e.message : (e as Error).message);
    process.exitCode = 1;
  } finally {
    ctx.db.close();
  }
}

void main();
