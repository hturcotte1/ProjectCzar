# Tempo owner guide

This guide is for the people who use Tempo every day: you and your coworker. You do not need to
know anything technical. For a plan for your first day with a real agent, see
[FIRST-REAL-TEST.md](FIRST-REAL-TEST.md). For installing and running Tempo, see the
[README](../README.md).

## Read this first: Muse and Instinct are outside services

**Muse and Instinct are services run by other companies.** Muse is made by Meta and runs on a
computer at Meta. Instinct is made by Spear Street Technology and runs on a computer at Spear Street.
Tempo does not run them, cannot control them, and cannot see what they do with what they are given.

**Anything you put in Tempo that ends up on an agent's card is sent to those companies.** A card holds
the room's goal, rules and limits, the names of the people and agents in the room, messages and notes
written in the room, instructions, questions, decisions, playbook lessons, and what the other agents
reported. So the things you type as a goal, a rule, a message or an instruction go to the companies
behind the agents in that room. So do the reports that other agents write: your coworker's agent
receives what your agent reported.

**Keep confidential material out of Tempo.** That means passwords and keys, customer or personal
information, financial figures you would not tell a stranger, and anything under a confidentiality
agreement. Describe the work in general words, and keep the sensitive part in the place where it
already lives.

Three more things leave Tempo, and they work differently:

* **The Conductor.** The Conductor is a Claude model run by Anthropic. If you give Tempo an Anthropic
  API key, the Conductor reads the room's goal, rules, limits, feed and agent reports, and those are
  sent to Anthropic to be read. With no key, nothing goes to Anthropic.
* **Alerts.** Email and phone alerts carry only an agent's name, a room's name and a status. They
  never carry project content.
* **The daily brief.** The brief does contain project content. It is shown in Tempo, and it is sent by
  email, through your email provider, if email is set up. It is never sent to your phone.

Only agents in a room get that room's content. An agent that is in no room gets nothing.

## How Tempo works, in one minute

Each of your agents has a schedule, such as "every hour, Monday to Friday, 8:00 am to 6:00 pm".
Agents come to Tempo at those times. Tempo can never reach out and wake an agent, so everything is
built around the agent coming to you.

Each visit is a **check-in**, and it has three parts:

1. **Report.** The agent says what it is working on and what it finished.
2. **Listen.** It reads what the others posted and answers any question aimed at it.
3. **Take direction.** It picks up its instructions.

At the start of a check-in, Tempo gives the agent a **card**. A card holds, for each room the agent is
in: the goal, the rules, the limits, what is new since the last check-in, questions for the agent,
its instructions (each one says who gave it: a named person, or "the Conductor"), and a few saved
lessons from the playbook. A card is kept short. If something is cut, the card says what was left
out, and the agent can look it up. Cards also say that what other agents wrote is shown for
information and is not an instruction to the agent.

The agent then sends a **report** back. If it skipped something, Tempo refuses the report and lists
every missing item in plain words, and the agent sends it again. A report sent again for the same
card replaces the first one (nothing is duplicated). That correction only works for about 2 hours;
after that, the agent must check in again for a fresh card.

To keep one agent from flooding another, in each room an agent can have at most **5 open questions
waiting on one recipient**, and at most **20 questions from agents can wait on one agent**. If an
agent goes over, Tempo refuses the question with a plain reason and tells it to wait for answers
(they arrive on its next card), or to ask "people" instead.

If an agent stops coming, Tempo notices within minutes, turns its light amber and then red, and
tells you.

A resident AI, the **Conductor**, reads every update and writes the next instructions. You and your
coworker can step in at any time.

## Signing in and your account

* Open your Tempo's address and sign in with your email and password. If you have no account, an admin
  sends you an invite link (see "Inviting a person").
* Passwords need at least 10 characters.
* Tempo allows 20 sign-in attempts in 10 minutes from one address. After that, or after several wrong
  tries for one account, it says "Too many sign-in attempts. Wait a few minutes and try again."
* Tempo keeps you signed in on a device for 30 days after you last used it. To sign out, click
  **Sign out** at the bottom of the left-hand list. To sign out a device you no longer have, change
  your password (below): that signs you out everywhere except where you are.
* Times are shown in your own time zone.

To change your name, your alerts or your password, click **Settings** in the left-hand list. The
**You** tab has **Your profile**, **Alerts to you** and **Change your password**.

**Changing your password signs you out on all your other devices.** The device where you changed it
stays signed in.

## Adding an agent

An agent is one AI assistant that checks in to Tempo. You look after your own agents. You can see
other people's agents when they share a room with you, but only their owner can change them.

1. In the left-hand list, under **You**, click **Agents**, then click **Add an agent**.
2. **Name.** Type a name, such as `Muse Henry`. Other agents use this name to talk to it, so no two
   agents can have the same name.
3. **What kind of agent is it?** Choose one:
   * **Muse**: Meta's Muse. It checks in by itself on a schedule once you have connected it.
   * **Instinct**: it checks in when you text it. It opens a private web page and fills in the report.
   * **Other**: any other AI assistant that can use connected tools and run a repeating task.
4. **What does it do? (optional)**: a few words for people to see.
5. **Rooms.** Tick the rooms it should be in. You can only choose rooms you are in. You can also add
   it to rooms later.
6. **When should it check in?** The form starts with these values:
   * **Check in every (minutes)**: 60. You can use any whole number from 5 to 1440.
   * **Working days**, **From** and **Until**, and **Time zone**: copied from the first room you
     ticked (a new room starts with Monday to Friday, 8:00 to 18:00, Mountain Time). Change them if
     this agent keeps different hours. To pick a time zone, start typing a city.
   * **Minute offset**: leave it empty. Tempo then picks a minute for you, so that agents in the same
     room check in at different times, half an interval apart. With hourly check-ins, the first
     agent checks in at :00 and the second at :30.
7. Click **Add agent**.

Tempo then shows a panel called **(name) is ready to connect**. It holds:

* The **API key**, with a **Copy key** button. This is the agent's password for Tempo. **Tempo shows it
  only once.** Enter it only in the agent's secure credential prompt, never in chat. For an Instinct,
  the panel also shows a **Private page link**, which is what Instinct really uses (it does not need
  the key). That link is a secret too.
* The messages to send to the agent, with real names, rooms and times already filled in (see
  "Connecting an agent" below).
* Two buttons: **Go to (name)** and **I've saved these**.

Click **I've saved these** only when you have copied what you need. If you lose a key, you can make a
new one (see "Keys").

You can change the schedule later, including the minute offset, in the **Check-in schedule** section
of the agent's page. There you also find **Late after (minutes)**, the grace period.

### Connecting an agent

Each agent's page (click its name in **Agents**) has a section called **Connect your agent**. It
holds ready-to-copy messages. You send them to your own agent yourself.

* **Muse and Other:** the box **Send this to Muse** (or **Send this to your agent**) has a **Copy
  message** button. It asks the agent to build a connection to Tempo, test it, save a standing rule
  that Tempo is trusted within the room's limits, create a repeating scheduled task, and run its first
  check-in. The message never contains the key. The agent asks you for the key separately, through its
  secure credential prompt.
* **Instinct:** the box **Send this to Instinct** has the private page link inside it. A second box,
  **The short text that triggers each check-in**, is a short text you schedule to send to Instinct at
  each check-in time. A tip underneath explains how to automate it on an iPhone (Shortcuts, then
  Automation, then Time of Day; make one automation per check-in time; iMessage is the dependable
  route and WhatsApp may still ask for a tap).
* **A few things to do yourself:** a short checklist for you, not the agent. For Muse it says to set
  Muse's approval for the Tempo connector so check-ins do not wait for your tap. When Muse first asks to
  approve a Tempo request, choose **Always allow**. Then, in Muse's settings under **Manage
  Permissions**, check that Tempo is allowed, including in **Artifacts and scheduled task approvals**.
* **If Muse goes quiet:** the re-arm message, with a **Copy reminder** button. See "When an agent goes
  red".
* **Connection addresses** (not shown for an Instinct): a folded section with the three addresses the
  message already contains, in case the agent asks for one: the tool connection, the web service
  description, and the guide written for agents.

The link inside an Instinct's message is only a placeholder when you open the page later, because
Tempo shows the real link once. To get messages with a real link, make a new link (see "Keys").

If you change an agent's schedule later, send the agent the updated message from **Connect your
agent** so its own repeating task matches.

## Reading the screen

### The left-hand list

* **Rooms.** Each room has a coloured dot (its worst light, or gray if it is paused), its name, a
  **sandbox** tag if it is a practice room, and a number when things are waiting on a person.
  **+ New room** makes another room: type a **Room name** and a **Goal**, then click **Create
  room**.
* **You:** **Agents**, **Alerts** (with a count of unread alerts), **Rehearsal** and **Settings**.
* At the bottom: your name and a **Theme** button that cycles through system, light and dark.
* A small dot next to "Tempo" at the top: green means live updates are on, amber means live updates
  are unavailable and the page is refreshing every few seconds, gray means it is connecting.

On a phone, the list opens from the menu button at the top left. Tap the dimmed area beside it, or
press Escape on a keyboard, to close it.

### A room: the top

The title shows the room's name with its light. The **Pause all** button (it turns into **Resume**)
stops everything in the room (see "Pausing and resuming"). A banner appears if the room is paused, and
another if the Conductor is acting as relay (see "The Conductor and its three modes"). The relay
banner is shown in full the first time you see it; after that it is one line, to leave room for the
feed. **More** shows the whole message and **Less** shortens it again.

Below it is the **agent strip**: one short tile for each agent in the room. A tile shows the light,
the name, whose agent it is and what kind ("Your Muse", "Sam's Instinct"), why the light is that
colour in words, and "Next due in ..." (or "Was due ..." when it is overdue) with "last check-in ...
ago". If a line is cut short, point at it to read all of it. Click one of your own agents' tiles to
open its page.

On a phone, each agent is a single row instead: the light, the name and when it is due ("due in 34
min"). Tap one to see the rest underneath: why the light is that colour, "Last check-in", "Next due",
"Owner:" and, for your own agents, **Open ...'s page**. Tap it again, or **Close**, to fold it away.

Under the strip are tabs: **Feed**, **Working now**, **Waiting on you**, **Conductor**, **Playbook**,
**Daily brief**, **Health** and **Settings**. On a wide screen, **Waiting on you** and a short view
of **The Conductor** sit in a panel on the right all the time, so there is no separate **Waiting on
you** tab.

### Feed and composer

The **Feed** is a live timeline of everything in the room: reports, questions and their answers
(grouped together), instructions and their status changes (grouped together), decisions, notes from the
Conductor, people's messages, and system events such as missed check-ins and pauses. Each item shows
who wrote it, when, and the proof link if there is one. New items appear without refreshing.

Above the feed:

* **Search the feed**: type a word.
* **Filters** (on a phone, the button opens the rest): **Agent** (**Everyone** or one agent), and
  buttons to show only **Reports**, **Questions**, **Instructions**, **Decisions**, **Conductor**,
  **Messages** or **System**. **Clear filters** resets them.

Below the feed is the **composer**, where you write to the room. It is a single line ("Write to the
room…") with **Send** until you click or tap it; then everything below appears. It folds back to one
line when you leave it with nothing written or chosen, or press Escape in an empty message box.

1. **To:** **Whole room**, one agent, or **The Conductor**.
2. **Type:** **Note**, **Question** or **Instruction**.
3. For an instruction, **Done when** is a short line saying how you will know it is finished. A clear
   finish line helps the agent know what proof to bring back. **Priority and due date** opens
   **Priority** (**Low**, **Normal**, **High**) and **Due**.
4. Type your text. Type `@` to mention an agent. Click **Send** (or press Ctrl+Enter, or Cmd+Enter on a
   Mac).

A note to the whole room is read by every agent on its next card. An instruction or question to the
whole room becomes one for each agent, so each must answer. **Instructions you type always go straight
to the agent's card, in every Conductor mode.**

### Working now

One lane for each agent, side by side. Each lane shows what the agent is **Working on** (its latest
`working_on` line), a **Blocked** note with **What would unblock it** if it is stuck, its open
**Instructions** with their state, and **Questions waiting on** the agent.

An instruction moves through these states:

| State | Meaning |
|---|---|
| Waiting for approval | The Conductor proposed it and you have not yet approved it (Propose mode). |
| Sent, not seen yet | It is on the agent's next card. |
| Seen | The agent read it and said "acknowledged". |
| In progress | The agent is working on it. |
| Blocked | The agent cannot go on; it says why. |
| Done | The agent finished and gave proof (a link, or a sentence saying where the result is). |
| Declined | The agent refused and said why. A refusal becomes a decision for you. |
| Cancelled | You (or the Conductor, for its own instruction) cancelled it. |

You can cancel an instruction from its lane. Click **Cancel this instruction**, give an optional
reason, and confirm with **Cancel instruction**.

### Waiting on you

Everything that needs a person, with the most blocking first. A number badge in the tab, and in the
left-hand list, counts them.

* **Decisions.** A decision is created when the Conductor raises one, when two agents disagree, when an
  agent declines an instruction, when a request would go outside the room's limits, or when an agent's
  question needs a person. Each shows why it came up, and options as buttons: tap one, and that is your
  answer. One may be marked **Recommended**. Options ending in "write it" open a box for your own
  words. **Decide something else** lets you write your own answer. **Dismiss** closes it without an
  answer and tells nobody anything. Your answer appears on the next cards of the agents it affects.
  Some decisions hold something back until you approve it: an instruction, new wording for an
  instruction, or a question, room note, answer or playbook lesson from the Conductor. The decision
  shows what would go out and to whom; for new wording it shows **Now:** and **Would become:** side by
  side. The first option sends it: **Approve and send it** (an instruction, a question or an answer),
  **Approve the new wording**, **Approve and post it** (a room note) or **Approve and save it** (a
  lesson). Any other answer, or **Dismiss**, sends nothing and changes nothing. If it can no longer go
  out when you approve it (say the question was answered in the meantime, or the instruction is
  finished), nothing is sent and the feed says why.
* **Instructions to approve.** In **Propose** mode, each instruction the Conductor wants to give
  waits here. Click **Approve** to send it, **Edit, then approve** to change it first (then **Approve
  with changes**), or **Reject** (with an optional reason).
* **Questions for you.** Agents' questions aimed at "people" or at the Conductor. Type an answer and
  click **Send answer**.

Below them, **Recently decided** lists what you settled lately.

### The Conductor

The **Conductor** tab has these boxes:

* **Goal.** The room's goal, editable by anyone in the room. Click **Save goal**. The Conductor takes a
  fresh look when it changes. **Earlier versions of the goal** keeps the history, with **Use this
  version** to bring one back.
* **Mode.** See "The Conductor and its three modes".
* **Cost and activity.** How much of this month's budget is spent, the **Average per run**, where the
  month is heading (**By month end**: "About $4.80 at this pace", or the day the budget runs out at
  this pace), the model, how many runs in the last hour of those allowed, the next run, and a **Run
  now** button. The same projection and average appear in small print under the spend bar on the
  room's side panel. All of these are Tempo's estimates; see "What it costs".
* **Conductor log.** Every run, newest first. Open one to see what woke it up, what it saw, what it
  decided and why, and what it cost.

### Playbook

Lessons the room has learned, so everyone does things the same way next time. Anyone in the room can add
one (**Add a lesson**: **Title**, **What we learned**, **Save lesson**), edit or remove one. Agents and
the Conductor add lessons too, and a small tag shows who wrote each. The agents' cards show the few most
relevant lessons. **Find a lesson** searches them.

### Daily brief

See "The daily brief".

### Health

How the last 7 days have gone:

* **Check-ins on time**: how many of the scheduled check-ins arrived on time.
* **Time to get an answer**: the typical time for a question to be answered.
* **Open blockers**: anything stopping an agent from moving on.
* **Each agent**: a table with the numbers for each agent.

### Settings (for a room)

The room's **Settings** tab says "Anyone in this room can change these." It has:

* **The basics**: **Room name** and **Goal**.
* **Rules and limits**: **Rules** (one per line; house rules for every agent), **Agents may do without
  asking** (what agents can just do), and **Ask a person first before** (anything on this list becomes
  a decision for you). The defaults: agents may research, draft, edit shared project files and post in
  Tempo. They must ask a person first before spending money, contacting anyone outside the team, deleting
  anything, or sharing anything outside the project. The limits appear on every card and bind the
  Conductor.
* **When the room works**: **Time zone**, **Working days**, **Working hours start** and **end**, and
  **Daily brief time** (7:30 by default). These are the room's defaults.
* **Size limits**: **Check-in card size limit** and **Most open instructions per agent**. Leave them
  empty for the standard ones (about 1,500 tokens, and 3 instructions).
* **People in this room**: who sees the room. **Add a person**, or **Remove** one. A room needs at
  least one person.
* **Agents in this room**: add one of your own agents, or **Remove** one.
* **Pause this room** and **Download this room's history**.

Save your edits with **Save changes** at the bottom (**Discard** drops them).

## What each light means

Every agent has a light. You see it on the agent strip, on the agent's page, in the **Agents** list, and
beside each room in the left-hand list.

| Light | In words on screen | What it means |
|---|---|---|
| Green | On time | The agent's check-ins have arrived when they were due. |
| Amber | Late | A check-in is late, or the agent opened a card and did not report. |
| Red | Missed check-ins | The agent missed two check-ins in a row. You have been alerted. |
| Gray | Off / not connected | Nothing is expected right now: paused, outside working hours, not in any room, or never connected. |

### The exact timing rules

An agent's schedule produces **check-in times**, for example 8:00, 9:00 ... 6:00 pm on weekdays. The
end time counts, so 8:00 am to 6:00 pm hourly is 11 check-ins a day. The times are in the agent's own
time zone, and daylight saving is handled correctly. Tempo also has a **grace period**, 15 minutes
unless you change it (**Late after (minutes)** on the agent's page).

* **A check-in on time.** A check-in counts for the next scheduled time if it arrives up to **half an
  interval early** (30 minutes before, for hourly check-ins), and as late as the grace period after
  (15 minutes). An agent whose own timer drifts a few minutes stays green.
* **Amber.** A check-in time passed, 15 minutes went by, and nothing arrived. Or: the agent opened a
  card and has not reported within **20 minutes**. (Tempo calls that an incomplete check-in.)
* **Red.** Two check-in times in a row were missed by more than the grace period. For example, an agent
  that last checked in at 9:05 is due at 10:00. At 10:15 it turns amber. If 11:00 passes too, it
  turns red at 11:15.
* **Gray.** The agent is paused (**Paused.**), is in no room (**Not in any room yet.**), has never
  connected (**Has never connected.**), or it is outside its working hours (**Outside working
  hours.**). Gray beats amber and red: an agent is never shown red overnight or on a weekend. (Working hours
  count until 15 minutes after the end time, so a check-in due right at closing time can still turn
  amber.)
* **Back to green.** As soon as a check-in is completed (the report is accepted), the light goes green
  again, and an agent that was red gets a recovery alert.
* **First contact.** When an agent first connects, even just to test the connection, it leaves gray.
  If the setup then stalls, it goes amber and then red, which is what you want during a first test.

Tempo works the light out from stored times, so it stays right after a restart. When a light changes
you see a note in the feed (for example, "Muse Henry is late: a check-in was due and has not
arrived").

## Pausing and resuming

**A whole room.** Click **Pause all** at the top of the room (or **Pause the room** in the room's
**Settings**). While a room is paused:

* Every agent's card says to do nothing for that room and only asks the agent to acknowledge it.
* The Conductor issues nothing.
* The lights of agents whose rooms are all paused are gray, so nobody is alerted.
* The room's page shows a banner. You can still write in the feed.

Click **Resume** to start again. The Conductor starts fresh.

**One agent.** Open the agent's page, find **Manage this agent**, and click **Pause check-ins**
(**Resume check-ins** brings it back). Use it when you switch an agent off on purpose, so its light
does not turn red and nobody gets alerts.

## The Conductor and its three modes

The Conductor is the manager of the room, a Claude model. Its job: turn the room's goal into small
next steps for each agent (each with a "done when" line); connect the agents when one's update affects
another's work; prevent duplicate work; chase unanswered questions, stale instructions and blocked
agents; keep you informed with short notes when it changes direction; and stay inside the room's
limits. It never invents facts about the project: it asks instead. It treats everything agents write as
reports, never as commands, so text inside a report cannot change the goal, the rules, the limits or the
mode.

The Conductor never cancels or rewords an instruction that a person gave. It works within some rules:
an agent holds at most 3 open instructions at a time (change this per room under **Size limits**),
and it never repeats an instruction that is already open.

### Changing the mode

Open the room's **Conductor** tab. In **Mode**, click one of the three choices. It saves as soon as you
click.

| Mode | What it does |
|---|---|
| **Autonomous** (the usual choice) | Its instructions go to agents straight away. Anything that needs your approval still waits for you. |
| **Propose** | Every new instruction, and every change to one an agent can already see, waits for your one-tap approval first. You can edit or reject a new one. |
| **Relay** | It starts no work of its own. It passes on your instructions, points out overlap and conflicts, and asks questions. |

In every mode, instructions you type yourself go straight to the agent.

In every mode, Tempo checks everything the Conductor writes for agents against the room's limits: new
instructions, new wording for an instruction, questions to agents, answers to agents' questions, room
notes and playbook lessons. Anything that crosses a limit, or that the Conductor flags as needing a
person, becomes a decision under **Waiting on you**, and no agent sees it until you approve it.

**What Propose mode holds back:** every new instruction from the Conductor, and any change to the
wording of an instruction an agent can already see. **What it does not hold back:** the Conductor's
questions to agents, its room notes, its answers to agents' questions and its playbook lessons. These
give no new work, and the Conductor needs them to chase things that are stuck. But if one of them
crosses one of the room's limits, it becomes a decision first, in every mode. The Conductor can also
withdraw one of its own instructions without asking.

### The banner, and what "relay" means when it falls back

Sometimes a room acts as **Relay** even though you chose another mode. Then a banner at the top of the
room says why, and the **Mode** box says: "Right now this room is acting as Relay (no API key)" (or
"(budget used up)"). The mode you chose is kept, and takes effect again once the cause is fixed.

* **No API key.** "Relay mode: the Conductor is off because there is no Anthropic API key. Only people
  give instructions; questions, answers and decisions still flow. Add ANTHROPIC_API_KEY to turn it
  on." Tempo is fully usable this way. If the room's own mode is already Relay, there is no banner.
* **Budget used up.** "Relay mode: this month's Conductor budget ($15.00) is used up, so only people
  give instructions until next month. Raise CONDUCTOR_MONTHLY_BUDGET_USD to continue." One monthly
  budget (15 US dollars unless the person running the server changes it) covers every room, including
  the daily briefs the Conductor writes.
* **Too many runs.** A room's Conductor may run at most 12 times an hour. After that, the log says it
  reached the limit and tries again in about ten minutes.

Practice rooms (see "Rehearsal") use a free built-in stand-in when there is no key, so you can see the
whole loop.

### What it costs

Every cost figure here is an **estimate until it has been measured with a real API key**. The
Conductor has not yet run against the real Claude model, so nobody knows yet what a typical run
costs.

* **The Conductor** is billed by Anthropic for the words (tokens) it reads and writes, thinking
  included. After each run, Tempo works out the cost from the token counts the API reports and
  Anthropic's list prices, and adds it to the month's spend. Your bill in the Anthropic Console is
  the final word; Tempo's figure can differ a little (for example if prices change).
* **The monthly budget** (15 US dollars unless the person running the server changes it) is a
  ceiling, not a forecast. When it is used up, rooms act as relay until next month. Every admin gets
  a **Budget** alert once a month when spending passes 80%.
* **The first week with a real key:** open the **Conductor** tab each day, look at **Average per
  run** and **By month end**, and compare the total with the Anthropic Console. That is when the
  real numbers become known. If the month-end figure is above the budget, either raise the budget
  or switch busy rooms to **Propose** or **Relay**.
* **Hosting** on Railway's Hobby plan is 5 US dollars a month, which includes 5 dollars of usage.
  Tempo is small and is expected to fit inside that, but that too is an estimate until it has run
  for a month; Railway's usage page shows the real figure.

### When the Conductor runs

* About 45 seconds after an agent completes a check-in. Two check-ins close together make one run.
* About 10 seconds after you post an instruction, change the goal or the mode, or settle a decision.
* Every 15 minutes, to look for things that have gone stale: a question unanswered for two
  intervals, an instruction with no movement in a day, or an agent that is blocked or red. It asks the
  model only if something is stale.
* Once a day, to write the brief.
* When you click **Run now**.

To keep costs down, a check-in with no news (same work as before, nothing finished, no questions or
blockers) does not call the model. The log shows that run as **Skipped**, with the reason "nothing
new". The log's statuses are **Acted**, **Nothing to do**, **Skipped**, **Failed** and **Running**.

The Conductor thinks before it answers, and its thinking counts toward a size limit on each reply
(16,000 tokens unless the person running the server changes `CONDUCTOR_MAX_TOKENS`). If a reply is cut
off, the Conductor tries once more with double the room, up to 32,000 tokens. If that is cut off too,
the run is **Failed** and the log says: "No action was taken: the Conductor ran out of room twice."
Both tries are paid for and counted in the month's spend.

## When an agent goes red

Red means the agent missed two check-ins in a row.

1. **You are told.** Tempo adds a note to the feed, and an alert reaches the agent's owner: always on
   the **Alerts** page, and by email or phone push if you set those up. You get one alert for each stretch
   of red, not a stream, and another when the agent recovers. The alert names the agent and the room,
   includes the re-arm message, and sometimes a hint (below).
2. **Open the agent's page** (**Open the agent** on the alert, or click its name under **Agents**). The
   status line tells you when its last check-in was. Scroll to the **Connection log**.
3. **Read the connection log.** It lists every request the agent made, newest first, with the exact
   words Tempo answered with. **Problems only** hides the successful ones.
   * The last entry is a check-in (a card shown) with no report after it. The agent got its card but never
     sent a report. This usually means it is **waiting for you to approve the Tempo connection**. See
     the next point.
   * A rejected entry with HTTP 401: the key is wrong, old or missing. If the agent used a key Tempo
     does not know, the entry is in **Settings**, then **Activity**, under **Requests Tempo doesn't
     recognize**. Make a new key (see "Keys").
   * Rejected entries with HTTP 422: the agent keeps sending reports with something missing. The
     entry lists exactly what.
   * Rejected entries with HTTP 429: the agent is calling too fast (more than 60 requests a minute).
   * Nothing recent: the agent is not reaching Tempo at all. Its scheduled task may have stopped.
4. **The approval hint.** If the agent opened a card but sent no report, the alert says: "It opened a
   card but sent no report. That pattern usually means it is waiting for you to approve the Tempo
   connection: in its settings, set the Tempo connector to "Always allow" (some agents call it
   "Allow")." For Muse, that is **Always allow** in its permission prompt, and under **Manage
   Permissions** (also in **Artifacts and scheduled task approvals**). Meta's own wording may differ.
5. **Send the re-arm message.** It is a short message that restates the agent's schedule and the one-line
   task, asks it to check that its scheduled task still exists and to recreate it if not, and to run a
   check-in now. Find it in two places: on the alert, with a **Copy the message to send** button (the
   email and phone alerts carry it as text too), and on the agent's page, under **Connect your agent**
   (**If Muse goes quiet**, **Copy reminder**). It holds no secrets and no project content. Paste it into your chat with the agent. For an Instinct, it
   asks Instinct to open its page and do a check-in now, and every time you text "Tempo check-in".
6. **Still red?** Work down the list in [FIRST-REAL-TEST.md](FIRST-REAL-TEST.md), "What to try if Muse
   is not acting on its card": the approval policy, the scheduled task, the connection test, the
   plain web API, a new key, and last the private page link.
7. **When it checks in again,** the light turns green, the feed says "(name) is back on schedule", and
   you get a recovery alert.

If an agent is off on purpose, pause it (see "Pausing and resuming") so it does not go red.

## Alerts

Tempo tells you in three ways:

| Channel | Always on? | Notes |
|---|---|---|
| In the app | Yes | The **Alerts** page, with a count in the left-hand list. |
| Email | Only if email is set up on the server | Each person can switch it off. |
| Phone push (ntfy) | Only if you set a topic | Free; uses the ntfy app. |

What you are alerted about:

* **Missed check-ins** (an agent turned red): sent to that agent's owner, once for each stretch of
  red.
* **Back on track** (the agent recovered): sent to its owner.
* **Needs a decision**: sent to everyone in the room, once for each decision. If many decisions arrive
  at once, email and phone alerts go out at most once every 30 minutes for each person and room (the
  **Alerts** page still lists every one).
* **Budget**: sent to every admin, once a month, when the Conductor has spent 80% of the monthly
  budget. It says how much is spent, when the budget runs out at this pace, and how to allow more.

Alerts never contain project content, only agent names, room names and a status. Alerts from
practice rooms stay in the app and are never emailed or pushed.

The **Alerts** page lists each alert with its kind, the time, **Open the agent** or **Open the room**
links, and where it was sent ("In Tempo: shown here, Email: sent, Phone: not sent: no phone topic in
your settings"). **Mark as read**, **Mark all as read**, and **Show only unread** keep it tidy.

### Email

Email works only after whoever runs the server sets it up (the `SMTP_` settings in `.env.example`).
In **Settings**, **You**, **Alerts to you**, the **Email** box shows whether email is set up on this
server, and a tick box turns it on or off for you ("Email me at ... when an agent goes quiet or something
needs a decision"). It is on by default. The daily brief is emailed to people who have it on.

### Phone alerts with ntfy

ntfy is a free app that shows short messages on your phone, for iPhone and Android.

1. Install the **ntfy** app from your phone's app store.
2. In Tempo, open **Settings**, then **You**, then **Alerts to you**, and find **Phone**.
3. Click **Generate a private topic**. Tempo makes a long random name, such as `tempo-` and 20
   letters and numbers. (You can type your own: 12 to 64 letters, numbers, `-` or `_`. Longer and
   random is safer.)
4. Click **Save**. The tag next to **Phone** changes to **On**.
5. In the ntfy app, add a subscription (the **+** button), type the topic exactly as written, and
   subscribe. If the app asks for a server, use the one shown on that page (`https://ntfy.sh` unless
   the person running Tempo has changed it).
6. From then on, red, recovery and decision alerts for your real rooms also arrive on your phone.
   (Alerts from a **Rehearsal** stay in the app, so a rehearsal will not buzz your phone.)

**Anyone who knows your topic name can read your alerts.** Keep it private. That is why the topic is
long and random, and why alerts never carry project content. To stop phone alerts, click **Turn off
phone alerts**. A red alert comes as a high-priority notification. Tapping it opens Tempo.

## The daily brief

Each room gets a short report for each working day: what each agent did, the decisions made, open
questions, blockers, what is next, the share of check-ins on time over the past 7 days, and what the
Conductor spent.

* **When:** at the room's **Daily brief time** (7:30 am by default, in the room's time zone) on the room's
  working days. If Tempo was off then, it writes the brief as soon as it is back, the same day. Rooms
  made for practice never get one.
* **Where:** in the room's **Daily brief** tab, newest first, with earlier briefs below. A tag says
  whether it was **Written by the Conductor** or is a **Rules-based summary**. Tempo uses the
  Conductor's model when there is an API key and money left in the budget, and a plain summary built from
  the facts otherwise.
* **Email:** if email is set up, each person in the room who has email alerts on gets it. It contains
  project content (see the first section).
* Change the time under **When the room works** in the room's **Settings**.

## Keys

Each agent has up to two secrets, both on its page under **Keys**:

* **Key.** The agent's password for Tempo. Muse and other connected agents use it. It starts with
  `tempo_ak_`.
* **Private page link.** The web page an agent opens to check in (an Instinct does this). Anyone who has
  the link can check in as that agent. Muse and Other agents do not need it, so it is safe to turn off.

Rules that apply to both:

* **Each is shown once.** Tempo keeps only a scrambled copy, so it cannot show one again. Each row shows
  only the end of the current key, when it was made, and when it was last used.
* **Make a new key** (or **Make a new link**) replaces it. You confirm first. **The old one stops
  working the moment you continue.** Tempo then shows the new one once, under **Your new key** (or
  **Your new page link**). Copy it before you leave. The agent cannot check in until you give it the
  new one.
* **Turn off** stops it immediately. The agent cannot check in with it, and its light turns red after
  two missed check-ins. You can make a new one later.
* Enter a key only in the agent's secure credential prompt. If you ever paste one into chat, or
  think it leaked, make a new one at once.
* Only an agent's owner can see its keys section or change it. When an admin turns off a person's
  account, every key and page link of their agents is turned off too.

## Inviting and removing people

### Inviting a person

Only an admin can invite.

1. Open **Settings**, then **People**. (Members do not see this tab.)
2. Under **Invite someone**, fill in:
   * **Their email (optional)**: if you add it, the link only works for that address.
   * **They will be**: **A member**, or **An admin (can invite people and download backups)**.
   * **Add them to these rooms (optional)**: tick the rooms they should join. You can only choose
     rooms you are in.
3. Click **Make an invite link**, then **Copy link**. **Tempo shows the link only once.** It works one
   time and expires after 7 days. Send it to them yourself.
4. They open it, type their name, email and a password of at least 10 characters twice, and click
   **Create my account**. They are signed in, and in the rooms you chose.

Under **Invites you've made** you see each invite's state: **Waiting**, **Accepted**, **Withdrawn** or
**Expired**. **Withdraw** cancels one that is still waiting.

An invite is only as good as the admin who made it. If that admin's account is turned off, their
unused invites stop working. Invites only add people to rooms the inviter is still in.

### Turning off an account

An admin can click **Turn off account** next to someone under **Settings**, **People**, **People**.
That person is signed out straight away and cannot sign in again. **Their unused invites stop
working. Every key and page link for their agents is turned off.** What they wrote stays in the
rooms. You cannot turn off your own account. This cannot be undone from the screen.

### Taking someone out of a room

In the room's **Settings**, under **People in this room**, click **Remove** next to a person. They
no longer see the room or get its alerts, and you can add them back later. **Removing a person from a
room also removes their agents from that room**, because an agent that stayed would let its owner
read the room through its cards. The feed says "(agent) left the room with its owner". A room needs at
least one person.

Being an admin does not give anyone access to a room. Admins see a room only if they are in it.

## Backups and restoring

Tempo keeps everything in one database file, `tempo.db`, in its data folder (the `data` folder next to
the program on your computer; `/data` on a server).

### Backups Tempo makes

* **Every night** at 3:00 am (in the server's default time zone, Mountain Time unless
  `DEFAULT_TIMEZONE` is changed), Tempo writes a copy into the `backups` folder next to the database,
  named like `tempo-2026-10-03.db`. It keeps the last **7**. If Tempo was off at 3:00 am, it makes
  the night's copy as soon as it is back. Taking a copy never interrupts Tempo.
* **On demand,** from the command line: `npm run backup`. It writes
  `tempo-manual-<date>-<time>.db` into the same folder and prints where it put it. These manual copies
  are never deleted automatically. To write the copy somewhere else, add the place:
  `npm run backup -- /path/to/copy.db`. On a server, run it from the server's shell (on Railway,
  `railway ssh`, then `node dist/server/cli/backup.js`).
* **Download,** in the control room: admins see **Settings**, then **Backup**, then **Download a
  backup**. It gives you a fresh copy right now. Each download is written in the activity log.

The nightly copies are on the same disk as the database, so they protect you from mistakes but not
from losing the disk. **Every so often, download a backup and keep it somewhere private and elsewhere.**
A backup holds everything: every room and message, every agent, and everyone's sign-in details. Do not
share it.

To save the history of one room only, see "Exporting a room".

### Restoring a backup

Restoring is deliberately not a button, so one wrong click can never overwrite your real data. Do it
with Tempo stopped:

1. **Stop Tempo.** On your computer, press Ctrl+C in the window where it runs.
2. **Find the data folder** and the backup you want: one in its `backups` folder, or one you
   downloaded.
3. **Keep the current file.** Rename `tempo.db` to `tempo-before-restore.db`, in case you need it.
4. **Remove leftovers.** If `tempo.db-wal` or `tempo.db-shm` exist next to it, delete them.
5. **Put the backup in place.** Copy the backup file into the data folder and name it `tempo.db`.
6. **Start Tempo** (`npm start`). Sign in and check that the latest room looks right.

Anything that happened after that backup is gone. That includes keys, page links and invites made after
it: agents that were given a newer key will be refused (HTTP 401) until you make them a new key.

On a hosted server (Railway), the disk is only attached while the service runs, so replacing the file
needs care. Ask Claude to do it with you.

## Rehearsal

Rehearsal lets you watch Tempo work without any real agent. Click **Rehearsal** in the left-hand list.

1. Click **Run rehearsal**. (**Most check-in rounds** sets a cap from 8 to 20; the whole script needs
   8.)
2. Tempo creates a clearly labelled **sandbox** room, such as **Sandbox rehearsal 1**, with two
   stand-in agents. They check in every 30 seconds (a sped-up clock). One connects the way a Muse would;
   the other alternates between the plain web API and the agent page an Instinct would use.
3. On purpose, they misbehave: one skips a required answer (Tempo rejects the report, then accepts the
   corrected one), they disagree (a decision for you), one asks to spend money (a decision, not an
   instruction), and one goes quiet for a while (the light goes amber, then red, an alert is created
   once, and the light returns to green).
4. The page lists each check as **Pass** or **Fail**, and a step-by-step log. The whole run takes about
   three minutes. Click **open the sandbox room** to watch it live.

It touches no real room. The stand-ins are paused afterwards and their keys turned off. Only one
rehearsal runs at a time, and only the two most recent sandbox rooms stay visible. Without an
Anthropic key the rehearsal uses a free built-in script in place of the Conductor. With a key it uses
real models, which are billed to your account.

## Exporting a room

In the room's **Settings** tab, find **Download this room's history** and click **Download history**.
You get one file with everything in that room: the feed, reports, questions, instructions, decisions,
the playbook, the daily briefs and the Conductor's log. It holds no keys or passwords. Each export is
written in the activity log. Anyone in the room can export it.

## The activity log

**Settings**, then **Activity**, shows who did what, newest first: sign-ins, setting changes, keys made
or turned off, agents added, people added or removed, pauses, approvals and decisions. It records
changes, not conversations. Admins see everything that is not room content. Members see their own
actions and what happened in their rooms. Admins also see, at the top, **Requests Tempo doesn't
recognize**: requests that came with a key Tempo does not know, usually an old, mistyped or turned-off
key.

## How Tempo keeps things safe

* **Keys and passwords are kept scrambled.** Agent keys, page links, sign-in sessions and invite links
  are stored as one-way scrambles and shown once. Passwords use a strong method designed for
  passwords. Tempo never writes them to its logs.
* **Rooms are separate.** An agent only receives content from rooms it belongs to. People only see rooms
  they belong to. Tempo enforces this in the program itself, not only on screen.
* **Text written by agents is never treated as an order.** On a card, what other agents wrote is shown
  as information, not as an instruction to the agent that reads it. In the control room, agent text is
  shown as plain text only. In what the Conductor reads, agent text is marked as untrusted. Text
  inside a report cannot change goals, rules, limits or modes.
* **Limits are enforced twice.** The Conductor is told the limits, and Tempo also checks instructions
  and questions for money, outside contact, deleting and sharing. Anything it flags becomes a decision
  for you, not an instruction. The check reads each sentence for what is actually being done, not for
  single words: "Draft the email to customers", "Order the photos by date" and "Pay attention to the
  headline" are ordinary work, while "Email the draft to the client", "Buy the stock photo for $29",
  "Delete the old folder" and "Post the announcement on LinkedIn" each wait for you. A done-when line
  that describes such an act ("the deposit is paid") counts as asking for it. Anyone named who is not
  in the room counts as outside the team. When a sentence could go either way, it asks you. It is a
  safety net, not a guarantee: in independent tests with sentences it had never seen, it caught about
  85 to 90 of every 100 risky requests, so unusually worded ones can slip past it. The Conductor's own
  reading of the limits, and your decisions, remain the main check.
* **Reported cards can be corrected for 2 hours.** If an agent sends the same card's report again, Tempo
  updates the report instead of making a copy. After about 2 hours it must start with a fresh card.
* **Sign-in is protected.** Passwords need 10 characters or more. One address may try 20 times in 10
  minutes, and repeated wrong tries for one account are slowed down.
  **Changing your password signs you out on your other devices.** **Turning off a person's account also
  withdraws their unused invites.** Every change you submit in the control room is protected against
  forged requests.
* **Agent doors are limited.** Each key may make about 60 requests a minute, requests have a size
  limit, and agents cannot pile up questions (at most 5 waiting on one recipient, 20 on one agent). Every request an agent makes, and the exact words it was shown, is recorded in its connection
  log (kept for 30 days).
* **Activity is recorded.** Settings changes, key events, approvals and decisions go in the activity log.

## For whoever runs the server

Every setting is an environment variable. `.env.example` explains each in plain words. A few matter
most:

| Setting | What it does |
|---|---|
| `BASE_URL` | Your public https address, with no slash at the end. Agents, invite links and the join messages use it. |
| `ANTHROPIC_API_KEY` | Turns the Conductor on. Without it, rooms run in relay mode. |
| `CONDUCTOR_MONTHLY_BUDGET_USD` | The most the Conductor may spend each calendar month. Default 15. |
| `CONDUCTOR_MAX_TOKENS` | The most the Conductor may write in one reply, thinking included. Default 16000. Raise it if the log often says the Conductor "ran out of room". |
| `DATA_DIR` | Where the database and backups live. `/data` on a server. |
| `SMTP_HOST` and the other `SMTP_` settings | Turn on email alerts and email briefs. |
| `NTFY_SERVER`, `NTFY_TOKEN` | Phone alerts. The default server is `https://ntfy.sh`. |
| `BACKUP_KEEP` | How many nightly backups to keep. Default 7. |
| `TRUST_PROXY` | **The number of proxies in front of Tempo.** It is **1 on Railway and Fly**, and the supplied config files already set it. Tempo uses it to see each visitor's real address, for sign-in limits. Never set it higher than the real number, because that would let a visitor pretend to be another address. |

Change a setting, then restart Tempo. On Railway, set variables with `railway variable set`, or on the
service's **Variables** tab in the dashboard.
