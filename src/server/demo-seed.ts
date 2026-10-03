import type { AppContext } from './context.js';
import { withTx } from './context.js';
import { nextId } from './db/index.js';
import { iso } from './lib/time.js';
import { createPerson } from './services/auth.js';
import { openCard, submitReport } from './services/checkin.js';
import { addPersonToRoom, createAgent, createRoom } from './services/manage.js';
import { personPost } from './services/people-actions.js';
import { createDecision, createPlaybookEntry } from './services/work.js';
import { getAgent } from './services/repo.js';

/**
 * Realistic sample data: two people, a shared room with four agents and some history, and a second
 * room. Used by the development server and browser tests. Not used in production.
 */
export const DEMO_PASSWORD = 'tempo demo password';

export async function seedDemo(ctx: AppContext) {
  const henry = await createPerson(ctx, { name: 'Henry', email: 'henry@example.com', password: DEMO_PASSWORD, role: 'admin' });
  const sam = await createPerson(ctx, { name: 'Sam', email: 'sam@example.com', password: DEMO_PASSWORD, role: 'member' });
  const room = createRoom(ctx, henry, {
    name: 'Launch',
    goal: 'Ship the new landing page and launch email by Friday Oct 9. The page needs final copy, a pricing table and three customer quotes.',
    rules: ['Keep all drafts in the shared Launch doc.', 'Post a note before starting anything that takes more than an hour.'],
  });
  addPersonToRoom(ctx, { kind: 'person', id: henry.id, name: henry.name }, room.id, sam.id);
  const ops = createRoom(ctx, sam, { name: 'Ops', goal: 'Keep the weekly metrics report up to date.' });

  const museH = createAgent(ctx, henry, { name: 'Muse Henry', type: 'muse', room_ids: [room.id] });
  const museS = createAgent(ctx, sam, { name: 'Muse Sam', type: 'muse', room_ids: [room.id, ops.id] });
  const instH = createAgent(ctx, henry, { name: 'Instinct Henry', type: 'instinct', room_ids: [room.id] });
  const instS = createAgent(ctx, sam, { name: 'Instinct Sam', type: 'instinct', room_ids: [room.id] });

  const report = (a: { agent: { id: string } }, body: (card: any) => Record<string, unknown>) => {
    const agent = getAgent(ctx.db, a.agent.id)!;
    const card = openCard(ctx, agent, 'mcp');
    return submitReport(ctx, agent, body(card), 'mcp');
  };

  report(museH, (c) => ({
    card_id: c.card_id,
    rooms: [{ room_id: room.id, working_on: 'Writing the hero section copy: three headline options and a subhead.', finished: [{ what: 'Outline of the landing page', proof: 'https://docs.example.com/launch#outline' }], notes_for_others: 'Headline options will be in the doc by noon.' }],
    questions: [{ to: 'Muse Sam', text: 'Which pricing tier are we leading with on the page, Pro or Team?' }],
  }));
  personPost(ctx, henry, room.id, { kind: 'instruction', to: 'Muse Sam', text: 'Draft the pricing table with three tiers and a monthly/yearly toggle.', done_when: 'The table is in the Launch doc with prices filled in.', priority: 'high' });
  report(museS, (c) => ({
    card_id: c.card_id,
    rooms: c.rooms.map((r: any) => ({ room_id: r.room_id, working_on: r.room_name === 'Ops' ? 'Updating the weekly metrics sheet.' : 'Collecting three customer quotes from past emails.' })),
    answers: c.rooms.flatMap((r: any) => r.questions_for_you.map((q: any) => ({ question_id: q.id, answer: 'Lead with Team: it is what most trials convert to.' }))),
    instruction_updates: c.rooms.flatMap((r: any) => r.instructions_for_you.map((i: any) => ({ instruction_id: i.id, status: 'in_progress', note: 'Started from last quarter\'s numbers.' }))),
  }));
  report(instH, (c) => ({
    card_id: c.card_id,
    rooms: [{ room_id: room.id, working_on: 'Checking competitor launch pages for layout ideas.', blocked: { reason: 'The shared doc link asks me to sign in.', what_would_unblock: 'Henry sharing the doc with my email address.' } }],
  }));
  personPost(ctx, sam, room.id, { kind: 'note', to: 'room', text: 'Reminder: legal needs to see the pricing page before it goes live. https://example.com/legal-checklist' });
  report(instS, (c) => ({
    card_id: c.card_id,
    rooms: [{ room_id: room.id, working_on: 'Drafting the launch email subject lines.', notes_for_others: '<script>alert("not html")</script> is how an attack would look; it must show as text.' }],
    questions: [{ to: 'people', text: 'May I buy a $29 stock photo for the email header?' }],
  }));

  const at = iso(ctx.clock.now());
  withTx(ctx, (emit) => {
    createDecision(
      ctx.db,
      {
        roomId: room.id,
        title: 'Muse Henry and Muse Sam disagree on the headline tone',
        context: 'Muse Henry wants a playful headline; Muse Sam says the audience is finance teams and wants a plain one.',
        options: ['Playful headline', 'Plain headline', 'Something else (write it)'],
        recommendation: 'Plain headline',
        why: 'The pricing page targets finance teams.',
        source: 'disagreement',
        agentIds: [museH.agent.id, museS.agent.id],
        raisedBy: { kind: 'conductor', id: null, name: 'Conductor' },
        at,
      },
      emit,
    );
    createPlaybookEntry(ctx.db, { roomId: room.id, title: 'Put proof links on every finished item', body: 'Link straight to the section of the doc (use the heading anchor), so others can check it in one click.', author: { kind: 'person', id: henry.id, name: henry.name }, at }, emit);
  });
  const runId = nextId(ctx.db, 'run');
  ctx.db
    .prepare(
      `INSERT INTO conductor_runs (id, room_id, triggers, mode, model, status, started_at, finished_at, saw_summary, output, actions, summary, input_tokens, output_tokens, cost_usd, attempts)
       VALUES (?, ?, ?, 'autonomous', 'claude-sonnet-5-5', 'acted', ?, ?, ?, '{}', ?, ?, 5120, 640, 0.0166, 1)`,
    )
    .run(
      runId,
      room.id,
      JSON.stringify([{ kind: 'checkin', detail: 'Muse Sam checked in', at }]),
      at,
      at,
      '4 agents, 2 open instructions, 1 question waiting on people, 1 blocker.',
      JSON.stringify([{ kind: 'decision', id: null, text: 'Raised a decision about the headline tone.' }]),
      'Both Muses are working on page copy; asked people to settle the headline tone before more copy is written.',
    );
  return {
    sign_in: [{ email: 'henry@example.com', password: DEMO_PASSWORD }, { email: 'sam@example.com', password: DEMO_PASSWORD }],
    room_id: room.id,
    agents: [museH, museS, instH, instS].map((a) => ({ name: a.agent.name, id: a.agent.id, api_key: a.apiKey, page_link: `${ctx.config.baseUrl}/a/${a.pageToken}` })),
  };
}
