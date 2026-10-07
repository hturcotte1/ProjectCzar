import { describe, expect, it } from 'vitest';
import { limitConcern } from '../src/server/services/limits.js';
import { DEFAULT_LIMITS_ASK_FIRST } from '../src/server/services/repo.js';
import { MONEY } from './limits-cases.js';

/**
 * A room's own limits are matched by their own key words, even when they share a word with the
 * four defaults (budget, cost, remove, share). Only the four defaults are left to the built-in
 * rules (DECISIONS.md item 55).
 */
const withOwn = (own: string) => [...DEFAULT_LIMITS_ASK_FIRST, own];

describe("a room's own limits", () => {
  it('match by their own key words even when one of them is a word the built-in rules use', () => {
    expect(limitConcern('Change the budget numbers in the plan to match Q4.', withOwn('changing the budget numbers in the plan'))).toBe(
      'changing the budget numbers in the plan',
    );
    expect(limitConcern('Remove Dana from the Slack workspace.', withOwn('removing anyone from the Slack workspace'))).toBe(
      'removing anyone from the Slack workspace',
    );
    expect(limitConcern('Put the cost estimates in the client emails.', withOwn('cost estimates in client emails'))).toBe('cost estimates in client emails');
    expect(limitConcern('Change the headline on the pricing page.', withOwn('changing anything on the pricing page'))).toBe('changing anything on the pricing page');
  });

  it('still need every key word, in a clause that is not forbidden', () => {
    expect(limitConcern('Note which budget numbers look off.', withOwn('changing the budget numbers in the plan'))).toBeNull();
    expect(limitConcern("Don't change the budget numbers in the plan.", withOwn('changing the budget numbers in the plan'))).toBeNull();
  });

  it('never take the place of a default the room has: a money flag stays "spending money"', () => {
    expect(limitConcern('Buy the stock photo for $29.', ['changing the budget numbers in the plan', ...DEFAULT_LIMITS_ASK_FIRST])).toBe(MONEY);
    expect(limitConcern('Buy the stock photo for $29.', ['Spending money.'])).toBe(MONEY);
    // A room that reworded the default keeps its own words (unchanged).
    expect(limitConcern('Buy the stock photo for $29.', ['spending any money at all'])).toBe('spending any money at all');
  });
});
