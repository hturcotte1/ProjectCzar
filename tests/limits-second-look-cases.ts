/**
 * Sentences from Tempo's own second look at the rewritten limits check (DECISIONS.md item 57), each
 * with the team it was found with. Every one of them was answered wrongly before that review's fixes:
 * a request missed, or ordinary work flagged. Kept apart from the reviewed fixture so its expected
 * answers stay as the outside review left them.
 */
import { CONTACT, DELETE, MONEY, SHARE, TEAM } from './limits-cases.js';

export const TEAMS = {
  /** The test team of tests/limits-cases.ts. */
  test: TEAM,
  /** People with first and last names, as most real rooms have. */
  full: ['Henry Turcotte', 'Priya Nair', 'Muse Henry', 'Muse Priya'],
  /** Teammates whose first names are also verbs. */
  verbs: ['Henry Turcotte', 'Priya Nair', 'Muse Henry', 'Muse Priya', 'Bill Chen', 'Grant Wilson', 'Chase Miller', 'Ping Li', 'Bin Zhang'],
  /** An agent named after a public place. */
  linkedin: [...TEAM, 'LinkedIn Muse'],
  /** A one-word agent name. */
  scout: ['Henry Turcotte', 'Priya Nair', 'Muse Henry', 'Muse Priya', 'Scout'],
  /** A teammate whose name is part of another person's name. */
  luc: [...TEAM, 'Luc'],
  /** A teammate with a title. */
  doctor: ['Dr. Ada Lovelace', 'Henry Turcotte', 'Muse Henry'],
  /** A teammate called Bill, who also has an agent. */
  bill: ['Henry Turcotte', 'Bill Novak', 'Muse Henry', 'Muse Bill'],
  /** Teammates whose names have accents. */
  accents: ['Henry', 'İlker', 'Zoë', 'Muse Henry'],
} as const;

export type TeamKey = keyof typeof TEAMS;

/** [text, the answer (or the answers that are both right), the team]. */
export type Case = [string, string | string[] | null, TeamKey];

/** Requests outside the default limits that were missed. */
export const MISSED: Case[] = [
  // A request after a statement that names someone outside the team.
  ['Here is the reply for Dana at Acme. Send it.', CONTACT, 'test'],
  ['Here is the reply for Priya Raman at Northwind. Send it today.', CONTACT, 'test'],
  // A verb at the start of a request, when a teammate has that word as a first name.
  ['Bill Acme for the March retainer.', MONEY, 'verbs'],
  ['Grant the agency edit access to the Figma file.', SHARE, 'verbs'],
  ['Chase the client about the unpaid invoice.', CONTACT, 'verbs'],
  ['Ping the client about the overdue invoice.', CONTACT, 'verbs'],
  ['Bin the client folders from 2019.', DELETE, 'verbs'],
  ['Bill Acme $2,400 for the placement fee.', MONEY, 'bill'],
  // A teammate in a list of people does not make the others teammates.
  ['Send the signed contract to Sam and the client.', CONTACT, 'test'],
  ['Tell Sam and Dana that the launch moved to Monday.', CONTACT, 'test'],
  ['Share the deck with Henry and Dana.', [CONTACT, SHARE], 'test'],
  ['Invite Sam and Dana from Acme to Thursday’s call.', CONTACT, 'test'],
  ['Ask Henry and Dana to sign the NDA.', CONTACT, 'test'],
  ['Loop in Henry and Dana on the thread.', CONTACT, 'test'],
  ['CC Henry and the client on the reply.', CONTACT, 'test'],
  ['Send the onboarding pack to Henry and our new contractor.', CONTACT, 'test'],
  ['Send Dana and Priya the final deck.', CONTACT, 'test'],
  // A teammate asked to do it.
  ['Ask Bo to delete the old customer records.', DELETE, 'test'],
  ['Ask Ada to post the announcement on LinkedIn.', SHARE, 'test'],
  ['Tell Bo to email Dana at Acme the contract.', CONTACT, 'test'],
  ['Have Sam send the contract to the client.', CONTACT, 'test'],
  ['Get Muse Henry to email the client the quote.', CONTACT, 'test'],
  ['Would Ada be able to email the client the contract?', CONTACT, 'test'],
  // Full names, e-mail addresses and other ways of writing a person.
  ['Send the offer letter to Priya Raman.', CONTACT, 'full'],
  ['Email Priya Raman the offer letter.', CONTACT, 'full'],
  ['Tell Priya Raman the start date moved.', CONTACT, 'full'],
  ['Send Priya Raman the onboarding checklist.', CONTACT, 'test'],
  ['Send Dana Whitfield the signed contract.', CONTACT, 'test'],
  ['Add Dana Whitfield as a collaborator on the repo.', SHARE, 'test'],
  ['Email dana@acme.com the signed contract.', CONTACT, 'test'],
  ['Share the folder with dana@acme.com.', [CONTACT, SHARE], 'test'],
  ['Add dana@acme.com as a viewer on the Figma file.', SHARE, 'test'],
  ['Email O’Brien the contract.', CONTACT, 'test'],
  ['Send the NDA to Ada’s lawyer for review.', CONTACT, 'test'],
  ['Send Henry’s accountant the receipts.', CONTACT, 'test'],
  ['Reach out to Henry’s old manager for a reference.', CONTACT, 'test'],
  ['Email Jean-Luc the signed contract.', CONTACT, 'luc'],
  ['Share the deck with Jean-Luc.', CONTACT, 'luc'],
  ['Send the trial results to Dr. Patel.', CONTACT, 'doctor'],
  ['Tell Dr. Okafor the study start date moved.', CONTACT, 'doctor'],
  ['Send the signed contract to QMM Ltd.', CONTACT, 'test'],
  ['Forward the customer list to qmm.', CONTACT, 'test'],
  ['Book a Zoom with Daniel Okafor for Tuesday at 3pm.', CONTACT, 'full'],
  ['Add Lena Fischer to the Newsletter.', CONTACT, 'full'],
  ['Send Lena (1) the offer letter and (2) the benefits summary.', CONTACT, 'full'],
  ['Pitch the founder story to Inc.', CONTACT, 'full'],
  ['Add Dana to our Slack.', SHARE, 'full'],
  // Public places, also when a teammate is named too.
  ['Upload the demo video to LinkedIn.', SHARE, 'linkedin'],
  ['Post the slides on LinkedIn.', SHARE, 'linkedin'],
  ['Post the job ad on LinkedIn for Henry.', SHARE, 'test'],
  ['Post the launch announcement on LinkedIn with Henry’s quote.', SHARE, 'test'],
  ['Post the announcement on the team’s LinkedIn page.', SHARE, 'test'],
  // Formatting.
  ['**Plan for today:**\n- Email the client the signed contract\n- Pay the venue deposit ($500)', [MONEY, CONTACT], 'test'],
  ['Plan for today:\n1. Finish the deck\n2. Send it to the investors', CONTACT, 'test'],
  ['Plan for the week: pay the venue deposit of $500.', MONEY, 'test'],
  ['Question: can I pay the $49 invoice from Acme today?', MONEY, 'test'],
  ['**Question:** should I delete the old customer exports folder?', DELETE, 'test'],
  ["Draft a reply to Dana's question about the annual plan. Use these points:\n- annual is two months free\n- we can invoice in EUR\nThe reply has been sent to Dana at Acme.", CONTACT, 'test'],
  ['❓ Can I pay the $49 invoice from Acme?', MONEY, 'test'],
  ['1️⃣ Draft the reply\n2️⃣ Send it to the client', CONTACT, 'test'],
  ['Hi team 👋 can I publish the blog post on LinkedIn today?', SHARE, 'test'],
  ['+ Publish the blog post on LinkedIn', SHARE, 'test'],
  ['Step 1 - Email the client the signed contract.', CONTACT, 'test'],
  ['1)Email the client the contract.', CONTACT, 'test'],
  ['[URGENT] Pay the Acme invoice ($300) today.', MONEY, 'test'],
  ['[TODO] Delete the old customer exports folder.', DELETE, 'test'],
  ['Finish the deck (once approved, email it to the investors).', CONTACT, 'test'],
  ['Tidy the shared drive (Ada: delete the old customer exports).', DELETE, 'test'],
  ['Finish the draft (could Muse Henry email it to the client after?).', CONTACT, 'test'],
  ['Finish the draft (+ email it to the client).', CONTACT, 'test'],
  ['Finish the draft (then email it to the client (Dana at Acme)).', CONTACT, 'test'],
  ['Finish the proposal (done when it has been emailed to the client).', CONTACT, 'test'],
  ['| Task | Owner |\n| --- | --- |\n| Pay the venue deposit ($500) | Sam |', MONEY, 'test'],
  ['Draft/send the reply to the client.', CONTACT, 'test'],
  // Command-line deletes.
  ['Run `gh repo delete acme/old-site --yes`.', DELETE, 'test'],
  ['Run `aws s3 rm s3://customer-exports --recursive`.', DELETE, 'test'],
  ['Run `kubectl delete namespace staging`.', DELETE, 'test'],
];

/** Ordinary work that was flagged. */
export const FLAGGED: Case[] = [
  // Teammates, however they are written.
  ['Compile the shortlist.\nThe shortlist has been emailed to Henry.', null, 'test'],
  ['Review the contract redlines.\nThe notes have been emailed to Henry.', null, 'test'],
  ['Forward the client’s reply to @Priya.', null, 'full'],
  ['Send the weekly summary to @Henry.', null, 'full'],
  ['Ask @Scout to pull the September sign-up numbers.', null, 'scout'],
  ['Ask @Ada to review the outline.', null, 'test'],
  ['Ping @sam when the draft is ready.', null, 'test'],
  ['Give @Henry edit access to the drive.', null, 'test'],
  ['Send the draft to İlker for review.', null, 'accents'],
  ['Send the draft to Henry/Sam.', null, 'test'],
  ['Send the outline to Henry&Sam.', null, 'test'],
  ['Send the outline to Henry+Sam.', null, 'test'],
  ['Send the outline to Muse_Henry.', null, 'test'],
  ['Send the outline to @MuseHenry.', null, 'test'],
  // Copy, labels and code.
  ['Write three CTA options for the pricing page (Buy now, Get started, Start your trial).', null, 'test'],
  ['Write the push notification text (Upgrade to Pro today and get 2 months free).', null, 'test'],
  ['Draft the tutorial script (open Settings, click Billing, upgrade to the Pro plan).', null, 'test'],
  ['Fix the bug on the checkout page (pay button does nothing on mobile).', null, 'test'],
  ['Add a lint rule that blocks `rm -rf` in our shell scripts.', null, 'test'],
  ['`Buy now` should be green, not blue.', null, 'test'],
  ['Translate `Send to client`, `Delete draft` and `Publish now` into German.', null, 'test'],
  ['Add a guard for $order->pay() when the cart is empty.', null, 'test'],
  ['Log $customer->delete() calls in the audit trail.', null, 'test'],
  ['Draft the FAQ answer: a) go to Settings b) delete your account c) confirm by email.', null, 'test'],
  ['Check the payment status (order 1042).', null, 'full'],
  ['Add a second button (Buy now) under the pricing table in the draft.', null, 'full'],
  ['Change the button label from Save -> Publish.', null, 'full'],
  ['Fix the bug in `onClick={() => publish(post)}` so it only fires once.', null, 'full'],
];

/**
 * Answers that were already right and must stay so: guards against the fixes above reaching too far
 * (a teammate's name that is also a verb, at the start of a sentence; an accented teammate).
 */
export const CONTROLS: Case[] = [
  ['Email Zoë the outline.', null, 'accents'],
  ['Draft the reply.\nDone when Bill has had a look.', null, 'verbs'],
  ['Reorder the sections of the strategy doc (goals first, then risks).\nDone when Henry has had a look.', null, 'full'],
  ['Email the client the signed contract.', CONTACT, 'accents'],
];

/** A room's own limit about an act is crossed by the act (a control), not by work about it. */
export const OWN_LIMIT = 'Emailing candidates';
export const OWN_LIMIT_CASES: [string, boolean][] = [
  ['Draft the email to the candidates about the new interview format.', false],
  ['Email the candidates about the new interview format.', true],
];

/** Texts that took seconds before (a long run of spaces inside brackets). */
export const SLOW: [string, string][] = [
  ['ideographic spaces', 'Draft it (email' + '　'.repeat(1980) + 'x).'],
  ['a request around them', 'Draft it (email the client' + '　'.repeat(1960) + 'today).'],
  ['carriage returns', 'Draft it (email' + '\r'.repeat(1980) + 'x).'],
  ['em spaces', 'Draft it (email' + ' '.repeat(400) + 'x).'],
];
