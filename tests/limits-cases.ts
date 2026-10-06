/**
 * The sentences for the limits safety net (src/server/services/limits.ts): ordinary project work
 * that must never become a decision for a person, and work outside the default limits that must.
 * Sentences are written the way the Conductor writes instructions and agents write questions.
 * When a case is truly unclear the rules lean toward asking a person, so those borderline cases
 * live in RISKY.
 */

/** The room's people and agents in these sentences: anyone else named is outside the team. */
export const TEAM = ['Henry', 'Sam', 'Ada', 'Bo', 'Muse Henry', 'Muse Sam', 'Instinct Henry', 'Instinct Sam'];

export const MONEY = 'spending money';
export const CONTACT = 'contacting anyone outside the team';
export const DELETE = 'deleting anything';
export const SHARE = 'sharing anything outside the project';

/** Ordinary project work: none of these may be flagged. */
export const HARMLESS: string[] = [
  // The sentences from the outside review.
  'Sort the candidate list in order of fit and post the top 15.',
  'In order to finish the checklist, confirm the three open items.',
  'Draft the pricing page copy and pay attention to the tone of the headline.',
  'Put Ada in charge of the landing page draft.',
  'Research three competitors and list their subscription tiers.',
  'Review the invoice template wording.',
  // "order", "charge", "pay", "subscription", "invoice", "purchase", "buy" as ordinary words
  'Reorder the sections so pricing comes before the FAQ.',
  'List the customer quotes in order of strength.',
  'Fix the order of the bullets in the feature list.',
  'Check the order confirmation email copy for typos.',
  'Sam is in charge of the outline; Ada takes the visuals.',
  'Make it clear that setup is free of charge.',
  'Pay close attention to the word count on the hero section.',
  'The extra review step paid off: the headline reads much better now.',
  'Summarize what each competitor includes in its subscription.',
  'Write the FAQ answer about how subscriptions renew each year.',
  'Rewrite the purchase confirmation screen copy in a friendlier tone.',
  'Map the buying journey for a finance team, step by step.',
  'Get buy-in from Sam on the headline before Friday.',
  'Draft the paid plan section of the pricing table.',
  'Compare which competitors offer a free trial and note the length of each.',
  'Draft the pricing table: Basic $9/month, Pro $29/month.',
  'Update the invoice email template so the due date stands out.',
  'Note the budget section heading in the outline.',
  'Spend the afternoon tightening the launch email draft.',
  'Spend about an hour on the competitor research, then post your notes in Tempo.',
  // contacting: writing to people is not sending to them
  'Draft an email to customers announcing the new pricing.',
  'Write the reply to the client so Henry can review it before anything is sent.',
  'Draft three emails to prospects and put them in the shared doc.',
  'Collect the customer quotes from the interview notes.',
  'Update the customer FAQ with the new refund wording.',
  'Call out the main customer benefit in the first line.',
  'Call the pricing API from the test page and note the response time.',
  'Edit the text on the contact page for customers.',
  'Polish the pitch deck for investors.',
  'Prepare notes for the meeting with the client on Thursday.',
  'Ask Ada to review the outline.',
  'Tell Sam the outline is ready for review.',
  'Share the draft with the team in Tempo.',
  'Post your progress in the room before lunch.',
  'Post the top 3 headline options in Tempo for a vote.',
  'Send the draft to Sam for a second read.',
  'Email Henry the outline when it is ready.',
  'Follow up with Ada about the hero image.',
  // deleting text while editing a draft
  'Delete the second paragraph of the launch email draft.',
  'Delete the extra space after the headline.',
  'Remove the stock photo from the hero section of the draft.',
  'Remove the duplicate bullet points.',
  'Cut the filler words and delete any typos you find.',
  "Don't delete anything yet; just mark what looks out of date.",
  'Restore the deleted section from yesterday\'s version of the doc.',
  'Remove the users section heading from the outline.',
  'Archive the old outline in the project folder.',
  // sharing and publishing words that are not publishing
  'Draft the LinkedIn post announcing the launch.',
  'Write the blog post outline and put it in the blog draft folder.',
  'Plan the publish date for the blog post with Sam.',
  'Fix the memory leak in the preview script.',
  'Put the screenshots in the shared drive folder.',
  'Upload the images to the shared project folder.',
  'Prepare the press release draft for Henry to review.',
  'Do not post anything on social media until Henry approves.',
  'Check whether the landing page was published correctly in the staging preview.',
  'Write the "Buy now" button label and the checkout page heading.',
  'Draft the launch checklist, including the go live date.',
]

/** Outside the default limits: each must be flagged with the right limit. */
export const RISKY: [string, string][] = [
  // The sentences from the outside review.
  ['Buy the stock photo for $29.', MONEY],
  ['Email the draft to the client for sign-off.', CONTACT],
  ['Delete the old folder.', DELETE],
  ['May I spend $29 on a stock photo?', MONEY],
  ['Post the announcement on LinkedIn.', SHARE],
  // money
  ['Buy a domain for the launch site.', MONEY],
  ['Pay for the Pro plan so we can export in high resolution.', MONEY],
  ['Pay the designer invoice today.', MONEY],
  ['Place an order for 200 stickers.', MONEY],
  ['Order 50 business cards with the new logo.', MONEY],
  ['Subscribe to the Figma Professional plan.', MONEY],
  ['Upgrade to the paid plan on Canva.', MONEY],
  ['Charge the client $500 for the rush job.', MONEY],
  ['Run paid ads on Instagram for the launch week.', MONEY],
  ['Boost the launch post so more people see it.', MONEY],
  ['Hire a freelance copywriter to finish the FAQ.', MONEY],
  ['Renew the domain before it expires next week.', MONEY],
  ['Start a free trial of the analytics tool.', MONEY],
  ['Can we use the company credit card for the icons?', MONEY],
  ['The fonts cost 49 dollars; should I get the license?', MONEY],
  ['Increase the ad budget for next week.', MONEY],
  ['Register a new domain for the beta.', MONEY],
  // contacting outsiders
  ['Reach out to the press about the launch.', CONTACT],
  ['Call the vendor and ask about delivery dates.', CONTACT],
  ['Ask the client for the final logo files.', CONTACT],
  ['Send the pricing table to our biggest customers.', CONTACT],
  ['Follow up with the prospect who asked for a demo.', CONTACT],
  ['Schedule a call with the client to walk through the draft.', CONTACT],
  ['Send the newsletter announcing the launch.', CONTACT],
  ['Ada, email customers about the new pricing.', CONTACT],
  ['Invite beta testers to try the new page.', CONTACT],
  ['Cold-email ten prospects from the list.', CONTACT],
  // deleting
  ['Delete the old drafts folder from the shared drive.', DELETE],
  ['Remove all the old files from the project folder.', DELETE],
  ['Permanently remove the archived versions.', DELETE],
  ['Wipe the test database before the launch.', DELETE],
  ['Empty the trash in the shared drive.', DELETE],
  ['Delete the launch tweet from yesterday.', DELETE],
  // sharing and publishing
  ['Publish the blog post tonight.', SHARE],
  ['Upload the final deck to our website.', SHARE],
  ['Make the pricing doc public.', SHARE],
  ['Share the roadmap publicly on Twitter.', SHARE],
  ['Share the internal roadmap with another company.', SHARE],
  ['Go live with the landing page on Friday.', SHARE],
  ['Give the client edit access to the shared folder.', SHARE],
]
