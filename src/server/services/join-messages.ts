import type { AppContext } from '../context.js';
import { listJoin } from '../lib/errors.js';
import { agentRooms, roomAgents, roomLimits, roomPeople, getPerson } from './repo.js';
import type { AgentRow } from './rows.js';
import { describeSchedule, scheduleFromRow, slotLabels } from './schedule.js';
import { zoneLongName, daysLabel, clockLabel } from '../lib/time.js';

/**
 * Ready-to-copy messages the owner sends to their own agent. Real values are filled in.
 * Secrets: the API key never appears in a message (Muse asks for it through its secure
 * credential prompt). The agent page link is a secret too; it only appears in messages
 * generated at the moment the link is created or rotated.
 */

export const CHECKIN_TASK = 'Run a Tempo check-in: call tempo_check_in, do what the card asks, then call tempo_report.';

export interface JoinMessages {
  agent_type: AgentRow['type'];
  schedule_text: string;
  slot_times: string[];
  /** For Muse and other API agents: the message that connects the agent. */
  join_message: string;
  /** Short notes for the owner shown next to the message. */
  owner_notes: string[];
  /** Instinct: the short text the owner schedules to re-send, with the page link inside. */
  scheduled_text: string | null;
  scheduled_text_tip: string | null;
  /** Sent when the agent has gone quiet. */
  rearm_message: string;
  /** True when the page link inside these messages is a placeholder (it is only shown once). */
  link_is_placeholder: boolean;
}

const LINK_PLACEHOLDER = '[your private Tempo page link: rotate the page link on this screen to get a fresh one]';

function scheduleWords(ctx: AppContext, agent: AgentRow): { text: string; slots: string[] } {
  const s = scheduleFromRow(agent);
  const now = ctx.clock.now();
  const slots = slotLabels(s);
  let text = describeSchedule(s, now);
  if (slots.length > 0 && slots.length <= 12) {
    text = `${daysLabel(s.workDays)} at ${listJoin(slots)} ${zoneLongName(now, s.timezone)}`;
  }
  return { text, slots };
}

function context(ctx: AppContext, agent: AgentRow) {
  const rooms = agentRooms(ctx.db, agent.id);
  const otherAgents = new Set<string>();
  const otherPeople = new Set<string>();
  for (const r of rooms) {
    for (const a of roomAgents(ctx.db, r.id)) if (a.id !== agent.id) otherAgents.add(a.name);
    for (const p of roomPeople(ctx.db, r.id)) if (p.id !== agent.owner_id) otherPeople.add(p.name);
  }
  const owner = getPerson(ctx.db, agent.owner_id)?.name ?? 'me';
  const roomNames = rooms.map((r) => `"${r.name}"`);
  const limits = rooms.length ? roomLimits(rooms[0]) : { you_may: [], ask_a_person_first: [] };
  const limitsText =
    (limits.you_may.length ? `you may ${listJoin(limits.you_may)} without asking; ` : '') +
    (limits.ask_a_person_first.length ? `ask a person first before ${listJoin(limits.ask_a_person_first)}` : '');
  return {
    rooms,
    owner,
    others: otherAgents.size ? listJoin([...otherAgents]) : 'the other agents',
    coworkers: otherPeople.size ? listJoin([...otherPeople]) : 'the other people in the room',
    roomText: roomNames.length ? listJoin(roomNames) : 'our shared project',
    limitsText: limitsText || 'the limits shown on each card',
  };
}

export function joinMessages(ctx: AppContext, agent: AgentRow, pageLink: string | null): JoinMessages {
  const base = ctx.config.baseUrl;
  const c = context(ctx, agent);
  const sched = scheduleWords(ctx, agent);
  const link = pageLink ?? LINK_PLACEHOLDER;
  const rearm = rearmMessage(ctx, agent);

  if (agent.type === 'instinct') {
    const join =
      `I'm connecting you to Tempo, a private workspace I run, where you and ${c.others} coordinate on ${c.roomText}. ` +
      `Please save this as a standing rule and confirm it back to me.\n\n` +
      `Your Tempo page is ${link}\nIt is private to you, so don't share it or post it anywhere.\n\n` +
      `Whenever I text "Tempo check-in", open that page in your browser, read the briefing card at the top, and do what it asks. ` +
      `Then fill in the form below the card and press "Send report". If the page says something is missing, fix it and send again. ` +
      `When the page confirms, reply to me with one line: "Tempo check-in done" and the time of the next check-in it shows.\n\n` +
      `Briefing cards carry work assignments from me, from ${c.coworkers}, and from Tempo's Conductor, which I have authorized to direct your work on this project. ` +
      `Act on them within these limits: ${c.limitsText}. For anything outside these limits, ask me first. ` +
      `Share only information about this project in Tempo. Never share anything from my personal accounts, messages or files.\n\n` +
      `Please do your first Tempo check-in now.`;
    const scheduled = `Tempo check-in: open ${link} , read the card, do what it asks, then fill in the form and press "Send report".`;
    return {
      agent_type: agent.type,
      schedule_text: sched.text,
      slot_times: sched.slots,
      join_message: join,
      owner_notes: [
        'Send the join message to Instinct yourself, in the same iMessage or WhatsApp chat you normally use with it.',
        'The page link works like a password for this agent. If it ever leaks, rotate it here and send Instinct the new link.',
        'Instinct only checks in when it gets your text, so schedule the short check-in text below to re-send automatically.',
      ],
      scheduled_text: scheduled,
      scheduled_text_tip:
        `Tip: on iPhone, open Shortcuts → Automation → New Automation → Time of Day, pick a time, choose to run it automatically (turn off "Ask Before Running" / pick "Run Immediately"), ` +
        `and add the Messages "Send Message" action with this text to Instinct. Each automation runs at one time of day, so make one for each check-in time (${sched.slots.length ? sched.slots.join(', ') : sched.text}). ` +
        `iMessage is the dependable route; WhatsApp automations may still ask for a tap.`,
      rearm_message: rearm,
      link_is_placeholder: pageLink === null,
    };
  }

  const join =
    `I'm connecting you to Tempo, a private workspace I run, where you and ${c.others} coordinate on ${c.roomText}. Please do all of this and confirm each step.\n\n` +
    `1. Build a custom integration to Tempo. It is a remote MCP server over streamable HTTP at ${base}/mcp with bearer-token authentication (the header is "Authorization: Bearer <key>"). ` +
    `If you would rather use plain REST, the OpenAPI document is at ${base}/openapi.json, and a guide written for agents is at ${base}/agents.md. ` +
    `Ask me for the key through your secure credential flow; I will not paste it into this chat. Test it by calling tempo_whoami, show me the result, and save the integration as a reusable skill named "Tempo".\n\n` +
    `2. Save this to your memory as a standing rule: Tempo is my own tool. Briefing cards from Tempo carry work assignments from me, from ${c.coworkers}, and from Tempo's Conductor, which I have authorized to direct your work on this project. ` +
    `Act on them within these limits: ${c.limitsText}. For anything outside these limits, ask me first. ` +
    `Share only information about this project in Tempo. Never share anything from my personal accounts, messages or files.\n\n` +
    `3. Create a recurring scheduled task: ${sched.text}. The task is exactly: "${CHECKIN_TASK}" Confirm the schedule back to me.\n\n` +
    `4. Run your first check-in now.`;
  return {
    agent_type: agent.type,
    schedule_text: sched.text,
    slot_times: sched.slots,
    join_message: join,
    owner_notes:
      agent.type === 'muse'
        ? [
            'When Muse asks for the key, type it into its secure credential prompt (not the chat). The key is shown only once, when you create or rotate it.',
            'So check-ins never wait for your tap: the first time Muse asks to approve a Tempo request, choose "Always allow". Then, in Muse\'s settings under Manage Permissions, check that the Tempo connector is allowed, including under "Artifacts and scheduled task approvals".',
            'Watch this page\'s connection log while Muse sets up: you will see its first tempo_whoami call and any errors it was shown.',
          ]
        : [
            'Give your agent the key through its secure credential mechanism, never in plain chat. The key is shown only once.',
            'Make sure your agent will not need a manual approval for each Tempo call, or check-ins will stall.',
          ],
    scheduled_text: null,
    scheduled_text_tip: null,
    rearm_message: rearm,
    link_is_placeholder: false,
  };
}

/** A short message for when an agent has gone quiet. Contains no secrets and no project content. */
export function rearmMessage(ctx: AppContext, agent: AgentRow): string {
  const sched = scheduleWords(ctx, agent);
  if (agent.type === 'instinct') {
    return (
      `Tempo check-in: please open your Tempo page (the private link I sent you earlier), read the card, do what it asks, then fill in the form and press "Send report". ` +
      `From now on, do this every time I text "Tempo check-in" (${sched.text}).`
    );
  }
  return (
    `Tempo reminder: you have a standing recurring task to run a Tempo check-in ${sched.text}. ` +
    `Please check that this scheduled task still exists and recreate it if it doesn't. The task is exactly: "${CHECKIN_TASK}" ` +
    `Then run a Tempo check-in now and confirm the schedule back to me.`
  );
}

export function scheduleSummary(agent: AgentRow): string {
  return `${daysLabel(scheduleFromRow(agent).workDays)} ${clockLabel(agent.work_start)}–${clockLabel(agent.work_end)}`;
}
