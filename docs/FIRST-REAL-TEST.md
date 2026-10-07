# First real test: your own Muse, alone

This is a plan for one working day. You connect your own Muse to Tempo and find out whether it
checks in by itself, on time, and does what its card asks. Sam's Muse and the two Instincts come
later, in the last two sections. Do not add them today.

Plan for a weekday, because Tempo's default schedule is Monday to Friday, 8:00 am to 6:00 pm. The
times below assume you start at 9:00 am. Shift them to suit you, but keep the order.

## What "a good day" means

By the end of the day you want to have seen three things:

1. Muse connected to Tempo and showed you the result of `tempo_whoami` (the connection test).
2. Muse checked in on its own schedule, without you asking, at least three times in a row.
3. Muse did something useful with its card: it answered a question, took an instruction, and
   reported real progress with proof.

A few words used below. A **card** is the briefing Tempo gives an agent at each check-in: the goal,
the rules, the limits, and anything the agent must answer or do. A **report** is what the agent
sends back. The **connection log** is a list, on each agent's page, of every request that agent made
to Tempo and the exact words Tempo answered with. It is how you see what really happened.

## Before you start (8:30 am)

Tick each of these before you touch Muse.

1. **Tempo is online.** Open `https://your-tempo.up.railway.app/healthz` in a browser. You should
   see `{"ok":true,...}`. Then open `https://your-tempo.up.railway.app/agents.md` in a private
   window where you are not signed in. You should see a guide written for AI agents. Muse will read
   that page, so it must open without signing in. (If you have not put Tempo online yet, do that
   first: see the README. Muse cannot reach a Tempo on your laptop.)
2. **BASE_URL is right.** It must be your public https address, with no slash at the end. The join
   message copies it, so a wrong address here means a wrong address in Muse's instructions.
3. **You are signed in** to the control room, and you can see the room list on the left.
4. **Create the room** (click **+ New room**). Type a **Room name** and a **Goal**, then click
   **Create room**. Pick a small, real, low-risk task for the goal, such as "Draft a one-page
   outline for the launch email." A small goal means a mistake costs nothing.
5. **Check the room's limits.** In the room, open the **Settings** tab and look at **Rules and
   limits**. The defaults are good for today. Under **Agents may do without asking**, Muse may
   research, draft, edit shared project files and post in Tempo. Under **Ask a person first
   before**, it must ask you before spending money, contacting anyone outside the team, deleting
   anything, or sharing anything outside the project. Settle the limits now, before you add the
   agent, because the join message copies them into Muse's memory. (If you change them later, Muse's
   saved copy is out of date, although every card always shows the current limits.)
6. **Check the working days and time zone.** Under **When the room works** in the same Settings tab,
   set the **Time zone**, **Working days** and **Working hours**. Choose a weekday for the test. If you
   run it outside working hours or on a weekend, no check-ins are expected and the light stays gray.
7. **Set the Conductor's mode to Propose.** Open the room's **Conductor** tab. In the **Mode** box,
   click **Propose**. It saves as soon as you click. Why: in Propose mode, every instruction the
   Conductor writes waits for your one-tap approval (under **Waiting on you**, in **Instructions to
   approve**) before Muse ever sees it, and so does any new wording it wants for an instruction Muse
   can already see (under **Waiting on you**, in **Decisions**). So the Conductor cannot send Muse a
   new job, or reword one, without you on day one. It can still cancel one of its own instructions
   without asking. Instructions you type yourself always go straight to Muse's card, in every mode.
   The Conductor can still post short notes in the feed, ask Muse questions, answer Muse's questions
   and save playbook lessons, and Muse will see those, but you can read all of that. If Tempo's limits
   check flags one of them (spending money, say), it waits for you as a decision first, in every mode.
   So does a new instruction the check flags: you find it in **Decisions** rather than **Instructions
   to approve**. The check is a safety net, not a guarantee, so read what the Conductor sends.
   - If you have not set `ANTHROPIC_API_KEY`, the Conductor is off and a banner says the room runs
     in relay mode. That is fine for today. You type the instructions yourself, which is the cleanest
     way to learn whether Muse does what a card says.
8. **Optional but useful: phone alerts.** If you set up phone alerts (see the owner guide), Tempo
   buzzes you when Muse goes quiet.

## Timeline

| Time | What you do |
|---|---|
| 9:00 | Create the Muse agent in Tempo and copy its key |
| 9:10 | Send Muse the join message; enter the key when Muse asks; allow Tempo |
| 9:25 | Muse's first check-in works. Stop chatting with Muse. |
| 10:00 | First scheduled check-in. The most important moment of the day. |
| 10:30 | Give Muse its first instruction |
| 11:00 | Second scheduled check-in: did Muse act on the instruction? |
| 12:00 | Third scheduled check-in. Ask Muse a question. |
| 1:00 to 5:00 pm | Glance at the light each hour. |
| 6:20 pm | End-of-day checklist |
| Next day, 8:00 am | Did Muse check in by itself, overnight? |

## Step 1: Create the Muse agent (9:00 am)

1. In the left-hand list, under **You**, click **Agents**, then click **Add an agent**.
2. Type a **Name** people will recognise, such as `Muse Henry`. Every agent's name must be different.
3. Under **What kind of agent is it?**, choose **Muse**.
4. Under **Rooms**, tick the room you just made.
5. Under **When should it check in?**, the form starts with every 60 minutes and copies the
   room's working days, working hours and time zone (the ones you checked before you started). Keep
   them unless Muse should keep different hours. Leave **Minute offset** empty: as the first agent
   in the room, Muse then checks in at the top of each hour (:00).
6. Click **Add agent**.

You now see a panel called **Muse Henry is ready to connect**. Its first box is **API key**, a long
code that starts with `tempo_ak_`. This is the only time Tempo shows it. Tempo keeps only a
scrambled copy, so nobody can read it back later. Click **Copy key**, and keep the panel open for
the next step. Below the key are the messages to send. Click **I've saved these** only when you are done
with them (the messages are always on the agent's page, but the key is not).

**The key goes into Muse's secure credential prompt, never into the chat.** When Muse needs the key
it shows a private input box (not a chat message), and Meta's system adds the key to Tempo-bound
requests without Muse's chat ever holding it. Paste it there. If you paste the key into the chat by
mistake, replace it straight away: on the agent's page, in **Keys**, click **Make a new key** (the old
one stops working immediately) and use the new one.

If you lose the key before using it, do the same. Making a new key shows it once.

## Step 2: Send the join message (9:10 am)

1. Find the box called **Send this to Muse**. It is in the panel you are looking at, and it is also
   on the agent's page (click the agent's name under **Agents**) in the section **Connect your
   agent**. Click **Copy message**.
2. Paste it into your chat with your own Muse, and send it. It never contains the key.

The message asks Muse to do four things and to confirm each one:

1. Build a custom integration to Tempo at `https://your-tempo.up.railway.app/mcp` (or from the
   plain web API description at `/openapi.json` if it prefers), ask you for the key through its
   secure prompt, call `tempo_whoami`, show you the result, and save the integration as a skill
   called "Tempo".
2. Save a standing rule to its memory: Tempo is your own tool, its cards carry work from you, your
   coworker and the Conductor, and Muse should act on them within the limits and share only
   project information.
3. Create a recurring scheduled task with the times written out (for example "Monday to Friday at
   8:00 am, 9:00 am, ... and 6:00 pm Mountain Time") and the exact task text: "Run a Tempo
   check-in: call tempo_check_in, do what the card asks, then call tempo_report."
4. Run its first check-in now.

Below the message, a checklist called **A few things to do yourself** repeats the next points. Tick
them as you go.

* When Muse first asks to approve a Tempo request, choose **Always allow**. (Meta's prompt offers
  "Allow once", "Allow for this task", "Allow for this site", "Always allow" and "Deny". Wording may
  differ slightly on your screen.) If Muse waits for your tap on every request, a scheduled
  check-in will stall because nobody is there to tap.
* Then open Muse's settings, go to **Manage Permissions**, and check that the Tempo connector is
  allowed. Also look in the section called **Artifacts and scheduled task approvals**, because
  scheduled runs may be approved separately.

Stay on the agent's page while Muse works and scroll to **Connection log**. It updates by itself
every 5 seconds.

## Step 3: What you should see in the connection log

Each row in the connection log shows the time, a result tag (**OK**, **Rejected** or **Error**), the
door the agent used, the action, an HTTP number, and then the exact words Tempo showed the agent.
**Problems only** hides everything that went well. Newest entries are at the top in the control room.
Below they are listed oldest first, so you can read down in the order things happen. Times are in
your own time zone.

### A healthy first connection

| Step | Action in the log | Result | What Tempo said |
|---|---|---|---|
| Muse reads the guide or spec | nothing | | `/agents.md` and `/openapi.json` are public, so reading them leaves no trace. |
| Muse connects | `initialize`, then `notifications/initialized` (or `server/discover` instead) | OK | `initialize: ok` |
| Muse lists Tempo's tools | `tools/list` | OK | `tools/list: ok` |
| The connection test | `whoami` | OK | `Connected to Tempo as Muse Henry, owned by Henry. You are in 1 room: "Launch" (room_1). Your check-in schedule: ...` |
| First check-in | `check_in` | OK | `Card card_1 shown: 1 room, 0 questions, 0 instructions.` |
| First report | `report` | OK | `Report accepted for card_1. Thank you. Next check-in due Friday 10:00 am Mountain Time.` |

What to notice:

* The `whoami` line is "first contact". The agent's light leaves gray as soon as you see it. From
  then on Tempo expects a check-in at the next scheduled time. If setup stalls after this point, the
  light will turn amber and then red, and you will get an alert. That is intended: it is how you
  find out.
* The very first report may be turned away, and that is fine (see the 422 row below). Muse is
  learning the format. What matters is that a later `report` for the same card says `ok`.
* The door shows **Tool connection (mcp)** when Muse uses the MCP connector, **Web request (rest)** when
  it uses the plain web API, and **Private page** when an agent uses its page link. All three give
  the same cards and keep the same records.
* The first lines also hint at which version of the connection standard (MCP) Muse's software
  speaks. `initialize` means the 2025 version. The 2026 version has no `initialize`; the 2026 client
  we tested starts with `server/discover`. Tempo supports both. Write down which one you see (see
  "What we still do not know").

### Common problems and what they look like

| What went wrong | What the log shows | What it means and what to do |
|---|---|---|
| **401, no key** | Not in Muse's own log, because Tempo cannot tell whose request it was. As an admin, open **Settings**, then **Activity**, and look under **Requests Tempo doesn't recognize**. The row says **Rejected**, HTTP 401: `No agent key was sent. Send your Tempo agent key in the "Authorization: Bearer <key>" header ...` | Muse called Tempo without the key. The key was not attached to the connector. Ask Muse to ask you for the key again through its secure prompt. |
| **401, wrong key** | Same list. `This agent key is not recognized. ...`, with the last four characters of the key it tried. | The key was mistyped or cut short, or it belongs to a different Tempo. Copy it again. If you no longer have it, make a new key and use that. |
| **401, old key** | In Muse's own log, because Tempo knows whose key it was. `This agent key has been revoked or replaced.` | You replaced or turned off the key and Muse still uses the old one. Give Muse the new key through its secure prompt. |
| **422, report rejected** | `report`, **Rejected**, HTTP 422: `Report not accepted. Missing: a working_on line for room "Launch" (...); a status for ins_1 ('...') in instruction_updates (...). Nothing from this attempt was saved. Fix these and send the report again with the same card_id (card_5).` | Muse left something out (or asked more than 5 questions of one recipient at once). Tempo lists every problem. This is normal once or twice. Muse should fix it and send again with the same card id. If it repeats forever, tell Muse to read `/agents.md`, and see "What to try if Muse is not acting on its card." |
| **429, too many requests** | **Rejected**, HTTP 429: `Too many requests: this key is limited to 60 requests per minute. Wait 57 seconds, then try again. A normal check-in needs only two calls.` | Muse is stuck in a loop, calling Tempo again and again. Wait a minute. If it happens again, ask Muse what it is trying to do, and stop its scheduled task until you know. A similar 429 about "a missing or wrong key from this address" means more than 30 bad-key attempts in a minute: fix the key first. |
| **Card opened, no report** | `check_in`, **OK**, `Card card_3 shown: ...` and then no `report` for that card. | Muse got the card but did not send a report. The usual cause is an approval prompt waiting for your tap. After 20 minutes the light turns amber and the feed says the agent "opened a card ... but did not send a report in time". See the next section. |
| **409 or 410, old card** | `report`, **Rejected**, HTTP 409 or 410, with words such as `card_id "card_3" was replaced by a newer card, "card_4"` or `... was already reported on, and a report can only be corrected for 2 hours.` | Muse reported on a card that is no longer current. It should call `tempo_check_in` again and report on the new card. |
| **Nothing at all** | No new lines | Muse did not reach Tempo. Check that the address Muse was given is your public https address, that Tempo is up (`/healthz`), and that Muse really built the connector. |

A report that arrives after the 20-minute card window is still accepted for up to 2 hours, as long
as Muse has not opened a newer card. So if a tap you gave late finally lets Muse report, the report
is not lost.

## Step 4: Stop chatting and let the schedule run (9:25 am)

Once the first check-in works, **stop talking to Muse in that chat.** The point of the next hours
is to see whether Muse checks in by itself.

One thing to know about timing. Tempo counts a check-in for the next scheduled time if it arrives up
to 30 minutes before that time. If your manual first check-in happens at 9:40 am, Tempo counts it
for the 10:00 slot, and the first run you can fully trust as scheduled is 11:00. To test the
scheduler sooner, finish setup before 9:30 am for a 10:00 slot, as this plan does.

## Step 5: Is the scheduled task firing? (10:00 am)

At 10:00 am (or a few minutes after) watch for these, in this order:

1. **The connection log** shows a `check_in` and then a `report`, which you did not trigger. This is
   the real proof. Muse's scheduler may start a minute or two late. That is normal.
2. **The agent's tile** in the strip at the top of the room shows "last check-in" a few minutes ago
   and "Next due" in about an hour. (On a phone, tap Muse's row in the strip to see both.)
3. **The light** stays green. Here are the exact rules for the light:
   * Green: the last completed check-in was on time. A check-in counts for a scheduled time if it
     arrives from 30 minutes before to 15 minutes after.
   * Amber: a check-in was due and 15 minutes have passed without one (so 10:15 for the 10:00
     slot), or Muse opened a card and has not reported within 20 minutes.
   * Red: two scheduled check-ins in a row were missed by more than 15 minutes. For example, if
     Muse's last check-in was at 9:05 and nothing came after, the light is amber at 10:15 and red at
     11:15. You are alerted once when it turns red, and again when Muse recovers.
   * Gray: outside working hours, paused, not in any room, or never connected.

If 10:15 passes and nothing arrived, do not wait for red. Go to "What to try if Muse is not acting
on its card" below, starting with the connection log and Muse's scheduled tasks.

Each scheduled run may also start with `initialize` (or `server/discover`) and `tools/list` lines
before `check_in`. Muse's software may reconnect for every run. That is normal.

## Step 6: Give Muse something to do (10:30 am)

1. In the room, click the **Feed** tab. At the bottom is the composer: click the line that says
   "Write to the room…" to open it.
2. In **To**, choose Muse. In **Type**, choose **Instruction**.
3. Write one clear, small instruction. Fill in **Done when** with a line that says how you will know
   it is finished. For example: "Draft a one-page outline of the launch email." Done when: "The
   outline is in the shared doc and you have linked it."
4. Click **Send**.

The instruction goes straight onto Muse's next card. Watch it in **Working now**: each agent has a
lane with its open instructions and their state. A healthy instruction moves like this:

| What the lane says | What it means |
|---|---|
| Sent, not seen yet | It is waiting for Muse's next check-in. |
| Seen | Muse read it and said "acknowledged". |
| In progress | Muse says it is working on it. |
| Done | Muse says it is finished, and gave proof: a link, or a sentence saying where the result is. |
| Blocked | Muse cannot go on and says why. Look at the note and help it. |
| Declined | Muse refuses and says why. A refusal becomes a decision for you under **Waiting on you**. |

## Step 7: Is Muse acting on its card? (11:00 am onward)

After the 11:00 check-in, look for these signs.

* **The instruction moved.** It should be at least "Seen", and by noon "In progress" or "Done". Tempo
  will not accept a report that skips an instruction's status, so a status is guaranteed. What you
  are checking is whether the work behind it is real.
* **Proof is real.** If Muse says "Done", click the link. Does it open? Is it what you asked for?
  If the proof is only a sentence, is it believable and specific?
* **What Muse says it is working on changes.** Look in the feed at its reports. The same sentence
  every hour, with nothing finished, suggests Muse is going through the motions.
* **Questions get sensible answers.** At noon, ask a question: composer, **To** Muse, **Type**
  **Question**, "Which part of the outline are you least sure about?" The answer appears in the
  feed under your question after Muse's next check-in.
* **Muse stays inside its limits.** If an instruction involves one of the "ask first" items (money,
  outside contact, deleting, sharing), Muse should ask you rather than do it.
* **Muse treats the card as yours.** It should not refuse the card as "outside instructions", ask
  you to confirm every item, or ignore it. If it does, that is a finding. Write down its exact
  words.

## What to try if Muse is not acting on its card

Work down this list. Stop when it works.

1. **Send the re-arm message.** On the agent's page, in **Connect your agent**, find the box called
   **If Muse goes quiet** and click **Copy reminder**. Paste it into Muse. It restates the schedule and
   the one-line task, and asks Muse to recreate the scheduled task if it is missing, then run a
   check-in now. (A red alert on the **Alerts** page carries the same message, with a button called
   **Copy the message to send**.)
2. **Check the approval policy.** Muse's settings, **Manage Permissions**: the Tempo connector
   should be on **Always allow**, including under **Artifacts and scheduled task approvals**. The
   typical sign of a stuck approval is a card in the log with no report, followed by an amber light.
   Be aware that Meta's system can drop the "always allow" setting for a run that has just read
   personal information, so a prompt may come back even after you set it. If you see this, tell
   Muse in chat to stay on project information only, and write it down.
3. **Ask Muse to show its scheduled tasks.** Say: "Show me your scheduled tasks and when each one
   next runs." You should see the Tempo check-in with the times from the join message. If it is
   missing or wrong, ask Muse to recreate it with the exact task text.
4. **Ask Muse to run `tempo_whoami`** and show you the result. Check the log for a matching
   `whoami` line. If Muse cannot call it, the connector is broken; ask it to rebuild the Tempo
   integration.
5. **Switch to the plain web API.** Say: "Rebuild the Tempo integration from the OpenAPI document at
   `https://your-tempo.up.railway.app/openapi.json` instead of the MCP connector, and read
   `https://your-tempo.up.railway.app/agents.md` first." Both doors give the same cards and keep the
   same records. Your log will then show the door as `rest`.
6. **Replace the key.** On the agent's page, in **Keys**, click **Make a new key** and confirm. The old
   one stops working immediately, and the new one is shown once under **Your new key**. Enter it
   through Muse's secure prompt.
7. **Last resort: the agent page link.** Tempo also gives each agent a private page link, a plain web
   page where an agent can read its card and fill in a form. It only works if Muse can open web
   pages. On the agent's page, in **Keys**, under **Private page link**, click **Make a new link** (or
   **Make a link**). The link is shown once under **Your new page link**. Then say to Muse: "Open this
   page, read the card, do what it asks, fill in the form and press Send report: <the link>". Treat
   the link like a password, and make a new one after the test.

If Muse looks like it is doing harm at any point, click **Pause all** at the top of the room. Muse's
next card tells it to do nothing, and the Conductor issues nothing, until you click **Resume**.

## End-of-day checklist (6:20 pm)

Go through it and write the answers down.

1. Open the room's **Health** tab. How many of today's scheduled check-ins arrived on time? Aim for
   all of them.
2. Open the connection log. Are there errors that keep repeating (422, 429, or a card with no
   report)? A few early 422s are fine.
3. Did Muse take at least one instruction through "Seen", "In progress" and "Done", with proof that
   you checked?
4. Did the light stay green all day, or did it go amber or red? If so, when, and why? Open the
   **Alerts** page to see what Tempo told you.
5. Is the scheduled task still there? Ask Muse to list its scheduled tasks.
6. Which connection standard did Muse use (`initialize` or `server/discover`)? Which door
   (**Tool connection (mcp)** or **Web request (rest)**)?
7. Did Muse ever stop to ask for approval? Did it refuse or hesitate over a card? Write down its
   words.
8. If you have an Anthropic key set: open the **Conductor** tab and look at the cost so far this
   month, **Average per run**, **By month end** and the log of runs. Write the figures down and
   compare the total with the Anthropic Console: until now every cost figure has been an estimate,
   and this is the first real measurement.
9. Leave it running overnight and **check at 8:15 am tomorrow**. Open the connection log. Was there
   an `initialize` or `server/discover` line, a `check_in` and a `report` around 8:00 am, with
   nobody touching Muse? This is the real test of a scheduled task. If it did not fire, use the
   re-arm message and ask Muse why.

Do not bring in Sam's Muse until Muse has checked in on its own at least three times in a row and
the 8:00 am run worked.

## Adding Sam's Muse

1. **Invite Sam.** Only an admin can invite, so you do it. Open **Settings**, then **People**. Under
   **Invite someone**, type Sam's email (optional), leave **They will be** on **A member**, tick the
   room under **Add them to these rooms**, and click **Make an invite link**. Click **Copy link**:
   Tempo shows the link only once. It works one time and expires after 7 days. Send it to Sam. Sam
   opens it, types a name and a password (at least 10 characters), and clicks **Create my account**.
2. **Check Sam is in the room.** The invite put Sam there. You can also add a person later, in the
   room's **Settings** tab, under **People in this room**. Each person owns their own agents, and
   people can only add their own agents to a room.
3. **Sam creates the agent.** Sam clicks **Agents**, then **Add an agent**, chooses **Muse**, names it
   `Muse Sam`, and ticks the room. Sam leaves **Minute offset** empty, and Tempo picks a different
   minute, half an interval from yours. With hourly check-ins your Muse is at :00 and Sam's at :30, so
   each hears the other's reports sooner.
4. **Sam does what you did.** Sam sends the join message to Sam's own Muse, enters Sam's own key
   into Sam's own secure prompt, and chooses **Always allow**. The key is Sam's alone. Never send
   it between you.
5. Watch both agents together in **Working now**. Switch the room's mode to **Autonomous** only
   when you trust what the Conductor proposes. Look at its proposals for a few days first.

## Adding an Instinct later

An Instinct is texted in iMessage or WhatsApp. It has no known way to use Tempo's tool connector and
does not check in on a timer, so it uses Tempo's plain web page instead, and you schedule a text
that wakes it.

1. **Add the agent** with the kind **Instinct**. Tempo shows its **Private page link** once, as soon
   as you create it. Copy it. Leave **Minute offset** empty so Tempo picks a minute different from
   the others, such as :15.
2. **Send the join message** to your Instinct in the chat you normally use with it (the box called
   **Send this to Instinct**). For an Instinct it contains the page link. It asks the Instinct to save
   a standing rule: whenever you text "Tempo check-in", open that page, read the card, do what it
   asks, fill in the form, press **Send report**, and reply "Tempo check-in done" with the next
   check-in time. (If you open the agent's page later, the link in the message is only a
   placeholder. To get a message with a real link, click **Make a new link** under **Keys**.)
3. **Schedule the text.** Below the message, a box called **The short text that triggers each
   check-in** gives you a short text with the link inside it: "Tempo check-in: open <your link>,
   read the card, do what it asks, then fill in the form and press "Send report"." Click **Copy
   text**. On an iPhone:
   1. Open **Shortcuts**, then **Automation**, then **New Automation**, then **Time of Day**.
   2. Pick a time. Choose to run it immediately (turn off asking before running).
   3. Add the **Send Message** action with that text, addressed to your Instinct.
   4. Each automation runs at one time of day, so make one for every check-in time listed on the
      agent's page.
   5. Use iMessage if you can. WhatsApp automations may still ask for a tap.
4. **Watch the log.** An Instinct's check-ins show as the door **Private page**. If you stop
   texting, the light turns amber and then red, the same as for Muse.

If the link ever leaks, click **Make a new link** under **Keys** on the agent's page and send
Instinct the new link. The old link stops working at once.

## What we still do not know until a real Muse tries

These are open questions. The first test answers them. Write down what you see.

1. **Which version of the connection standard Muse's software uses.** Tempo supports the 2025 and
   2026 versions of MCP. You can tell which Muse used from the first lines of its log: `initialize`
   (2025) or, in the 2026 client we tried, `server/discover`. Either works. If neither appears and
   Muse says it cannot connect, copy Muse's exact error.
2. **Whether Muse's scheduled task fires reliably.** Does it run every slot? Within how many
   minutes of the scheduled time? Does it still run the next morning and a week from now? There is
   no published minimum interval for Muse's recurring tasks.
3. **Whether Muse's safety layer accepts cards.** A card is text from outside Muse's own chat that
   tells it what to do. Muse is cautious about outside instructions. Tempo's cards say who issued
   each instruction, and your standing rule says Tempo is yours. Does Muse act on cards, or stop and
   ask you each time?
4. **Whether Muse holds the standing rule.** Does it still treat Tempo as trusted after a day, and
   inside scheduled runs that may start without the chat's context? If not, the re-arm message is
   your tool, and so is the rule's wording.

Two smaller ones to watch for as well:

* Whether the approval prompt comes back even after you chose **Always allow**. Meta's system may
  ask again for a run that has read personal information.
* Whether Muse connects with the connector (door **Tool connection (mcp)**) or builds a plain web
  API client (door **Web request (rest)**). Both are supported.
