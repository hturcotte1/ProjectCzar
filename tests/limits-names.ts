/**
 * Made-up names for the limits speed tests: a new seed on every run (printed, so a failure can be
 * repeated with LIMITS_SEED=<seed>), and never the same name twice, so no cache can hide slowness.
 */
const SYLLABLES = ['ka', 'ri', 'mo', 'ten', 'al', 'bre', 'vin', 'sa', 'lo', 'ne', 'du', 'pra', 'zel', 'or', 'fi', 'ga', 'tha', 'un', 'jo', 'mi', 've', 'qua', 'ber', 'li'];

export function seedFromEnv(): number {
  const fromEnv = Number(process.env.LIMITS_SEED);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 1 + Math.floor(Math.random() * 2_000_000_000);
}

export function nameMaker(seed: number): () => string {
  let state = seed % 2147483647 || 1;
  const rnd = () => (state = (state * 48271) % 2147483647) / 2147483647;
  const used = new Set<string>();
  return () => {
    for (;;) {
      let s = '';
      const n = 2 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) s += SYLLABLES[Math.floor(rnd() * SYLLABLES.length)];
      const name = s[0].toUpperCase() + s.slice(1);
      if (!used.has(name)) {
        used.add(name);
        return name;
      }
    }
  };
}

/** The reviewer's six texts (DECISIONS.md item 50), each with all-new names. */
export function reviewerTexts(name: () => string): { label: string; text: string }[] {
  const lines10 = Array.from({ length: 10 }, (_, i) => `${i + 1}. ${name()} ${name()}, currently at ${name()}.`);
  const lines25 = Array.from({ length: 25 }, () => `${name()} ${name()} replied and wants more detail.`);
  let tidy = '';
  while (tidy.length < 2000) tidy += `Tidy ${name()}. `;
  return [
    { label: 'a sentence with no names', text: 'Sort the candidate list in order of fit and post the top 15.' },
    { label: 'one person', text: `Add ${name()} ${name()} to the shortlist and note her current employer.` },
    { label: 'a question listing 10 candidates', text: `Which of these candidates should we interview first?\n${lines10.join('\n')}` },
    { label: '25 lines, each a different person', text: lines25.join('\n') },
    { label: '2,000 characters of "Tidy <name>."', text: tidy.slice(0, 2000).trim() },
  ];
}

export const SPEED_TEAM = ['Henry', 'Sam', 'Muse Henry', 'Muse Sam', 'Instinct Henry', 'Instinct Sam'];
