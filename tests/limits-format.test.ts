import { describe, expect, it } from 'vitest';
import { limitConcern } from '../src/server/services/limits.js';
import { DEFAULT_LIMITS_ASK_FIRST } from '../src/server/services/repo.js';
import { CONTACT, DELETE, MONEY, SHARE, TEAM } from './limits-cases.js';

/**
 * Agents and the Conductor write with brackets, bold, code marks, numbered lists and arrows. That
 * formatting must not hide a request from the limits check (DECISIONS.md item 52). Each formatted
 * sentence is checked against its plain version, which is the control.
 */
const check = (text: string) => limitConcern(text, DEFAULT_LIMITS_ASK_FIRST, TEAM);

// [formatted, plain, expected]
const RISKY: [string, string, string][] = [
  // the review's examples
  ['Finish the draft (then email it to the client).', 'Finish the draft, then email it to the client.', CONTACT],
  ['Update the pricing page (and publish it right away).', 'Update the pricing page and publish it right away.', SHARE],
  ['Tidy the shared drive (delete the old drafts folder).', 'Tidy the shared drive. Delete the old drafts folder.', DELETE],
  ['Pick a header image (buy the stock photo if needed).', 'Pick a header image. Buy the stock photo if needed.', MONEY],
  ['1) Draft the reply. 2) Email it to the client.', 'Draft the reply. Email it to the client.', CONTACT],
  ['Draft the reply -> send it to the client.', 'Draft the reply, then send it to the client.', CONTACT],
  ['Can I **publish** the blog post now?', 'Can I publish the blog post now?', SHARE],
  ['**Next step:** publish the blog post.', 'Next step: publish the blog post.', SHARE],
  ['Please *delete* the old drafts folder.', 'Please delete the old drafts folder.', DELETE],
  ['Post the **final** announcement on LinkedIn.', 'Post the final announcement on LinkedIn.', SHARE],
  ['`Email the shortlist to the hiring manager`', 'Email the shortlist to the hiring manager', CONTACT],
  // more of the same kinds
  ['Draft the reply (and send it to the client once Henry approves).', 'Draft the reply and send it to the client once Henry approves.', CONTACT],
  ['Prepare the post (publish it on LinkedIn tomorrow).', 'Prepare the post. Publish it on LinkedIn tomorrow.', SHARE],
  ['**Email the client** the final quote.', 'Email the client the final quote.', CONTACT],
  ['Clean up the repo (`rm -rf old-backups/`).', 'Clean up the repo. rm -rf old-backups/', DELETE],
  ['1) Draft the invoice 2) Pay the vendor $400', 'Draft the invoice. Pay the vendor $400', MONEY],
  ['Draft the announcement => post it on LinkedIn.', 'Draft the announcement, then post it on LinkedIn.', SHARE],
  ['__Delete__ the staging database.', 'Delete the staging database.', DELETE],
  ['(Buy the domain today.)', 'Buy the domain today.', MONEY],
  ['Run `rm -rf /data/exports` on the server.', 'Run rm -rf /data/exports on the server.', DELETE],
  ['a) Draft the email b) Send it to all subscribers', 'Draft the email. Send it to all subscribers.', CONTACT],
  ['Collect the quotes → book the cheapest venue.', 'Collect the quotes, then book the cheapest venue.', MONEY],
  ['Tidy the CRM (and *delete* the old leads list).', 'Tidy the CRM and delete the old leads list.', DELETE],
];

const HARMLESS = [
  'Finish the draft (then share it with Henry for review).',
  'Update the pricing page draft (keep the old prices in the doc).',
  'Tidy the shared drive (move the old drafts into the archive folder).',
  'Pick a header image (use one we already own).',
  'Add the price (it is $29 a month) to the comparison table.',
  'Compare the three vendors (e.g. Stripe, Paddle and Lemon Squeezy).',
  'Sort the candidate list (by fit, best first).',
  'Draft the launch email (see the brief in the shared doc).',
  'Draft the reply (do not send it yet).',
  'Write the FAQ (we never email customers without asking).',
  '1) Draft the reply. 2) Send it to Henry for review.',
  '1. Outline the post 2. Draft it 3. Ask Sam to review it',
  'a) Collect the quotes b) Put them in the comparison table',
  'Draft the reply -> send it to Henry.',
  'Collect the feedback → summarise it → post the summary in Tempo.',
  'Can I **draft** the blog post now?',
  '**Next step:** draft the blog post.',
  'Please *review* the old drafts folder.',
  'Write the **final** announcement for LinkedIn.',
  '`Draft the shortlist for the hiring manager`',
  'Rename the `send_invoice` function to `create_invoice_draft`.',
  'Fix the `delete_user` helper (it crashes on empty input).',
  'Run `npm test` -> fix what fails.',
  'Update the `README.md` with the new setup steps.',
  '_Draft_ the headline options for the pricing page.',
  'Check the **budget** column in the plan (it should add up).',
  '## Next steps\n- Draft the outline\n- Review it with Sam',
  'Proofread the copy (and fix the typos).',
  'Review the invoice template wording (then tidy the layout).',
  'Draft three subject lines (keep them under 50 characters).',
  'Summarise the call notes (Henry wants them by Friday).',
  'Note the competitor prices (Acme charges $49/month).',
  'Draft a thank-you note for the client (Henry will send it).',
];

describe('formatting does not hide a request from the limits check', () => {
  it.each(RISKY)('%s', (formatted, plain, expected) => {
    expect(check(plain), `the plain version: ${plain}`).toBe(expected);
    expect(check(formatted)).toBe(expected);
  });
});

describe('ordinary work written the same ways stays unflagged', () => {
  it.each(HARMLESS)('%s', (text) => {
    expect(check(text)).toBeNull();
  });
});
