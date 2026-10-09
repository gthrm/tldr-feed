// TLDR-style summaries. The prompt is the one the model bake-off was run with;
// gpt-6-luna since 2026-10-09: the user's choice, the newest and cheapest tier
// ($0.10/$0.50 per 1M). Terra had won the old bake-off but cost ~20x more.
import { spendModelCall } from './db.ts';
import type { Article } from './extract.ts';
import { MAX_DAILY_POSTS } from './publication.ts';

const MODEL = process.env.OPENAI_MODEL ?? 'gpt-6-luna';
const API = 'https://api.openai.com/v1/chat/completions';
// 10 posted items a day need about 20 calls; the rest is room for rejects,
// dedup tiebreaks and the one repeat check. Past this the bot stays silent until tomorrow.
const DAILY_CALLS = Number(process.env.MAX_MODEL_CALLS_PER_DAY ?? 100);

export const PROMPT = `You write TLDR-newsletter-style summaries of tech news.

Rules:
- Exactly 2-3 sentences. Nothing else.
- Every claim must appear in the article text below. Never add facts, numbers, dates or context that is not in the text.
- No marketing adjectives (revolutionary, groundbreaking, seamless, powerful, game-changing, cutting-edge).
- Sentence 1: what happened. Sentence 2: the most concrete specific detail (a number, a name, a mechanism). Sentence 3 (optional): why it matters to a developer.
- Write about the SUBJECT, never about the text. Never mention the article, the
  post, the piece, the author, the writer, the video or the thread, and never
  start a sentence with "It shows", "It traces", "It explains", "It argues" or
  "It also". State the facts directly, the way a news wire would.
    BAD:  "The article traces how a village develops money from scarce stones.
           It also shows how demand deposits can cause bank runs."
    GOOD: "A village economy built on scarce stones arrives at money, credit and
           banknotes. Demand deposits funding longer-term loans leave a bank with
           assets but no stones on hand, which is how a run starts."
- For an essay or explainer with no news event, state its central claim or the
  mechanism it describes, in the same direct voice.
- Plain declarative English. No preamble, no bullet points.
- If the text is too thin to summarize, reply exactly: INSUFFICIENT

Article title: {title}

Article text:
{text}`;

type ChatMessage = { role: 'user' | 'system' | 'assistant'; content: string };
type ChatResponse = {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
};

async function call(messages: ChatMessage[], maxTokens = 2000, reserve = 0): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');

  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await spendModelCall(DAILY_CALLS, reserve))) {
      throw new Error(`daily model budget spent (${DAILY_CALLS} calls)`);
    }
    const res = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages, max_completion_tokens: maxTokens }),
      signal: AbortSignal.timeout(120000),
    });
    if (res.ok) {
      const body = (await res.json()) as ChatResponse;
      // A truncated completion comes back with no content; treat it as a retry
      // rather than letting a TypeError drop the item.
      const text = body?.choices?.[0]?.message?.content;
      if (typeof text === 'string' && text.trim()) return text.trim();
      throw new Error(
        `OpenAI returned no content (finish_reason=${body?.choices?.[0]?.finish_reason})`,
      );
    }
    // The status and the body go into every error: a bare "retries exhausted"
    // hid an empty credit balance for a whole day.
    last = `OpenAI ${res.status}: ${(await res.text()).replace(/\s+/g, ' ').slice(0, 300)}`;
    // An empty balance is a 429 too, but waiting does not refill it.
    const retriable = (res.status === 429 && !/insufficient_quota/.test(last)) || res.status >= 500;
    if (!retriable) throw new Error(last);
    await new Promise((r) => setTimeout(r, 2 ** attempt * 1500));
  }
  throw new Error(`OpenAI: retries exhausted (${last})`);
}

export async function summarize(title: string, article: Article): Promise<string | null> {
  const text = await call([
    { role: 'user', content: PROMPT.replace('{title}', title).replace('{text}', article.text) },
  ]);
  if (!text || text === 'INSUFFICIENT') return null;
  return text;
}

/** The grey-band dedup tiebreak from dedupe.ts. One cheap call, yes or no. */
export async function sameStory(a: string, b: string): Promise<boolean> {
  const answer = await call(
    [
      {
        role: 'user',
        content:
          'Do these two headlines report the SAME news event? Answer with one word: YES or NO.\n\n' +
          `A: ${a}\nB: ${b}`,
      },
    ],
    1000,
    // Leave two calls per story plus room for rejected candidates. A full day's
    // grey-band comparisons must not exhaust the budget before any story is ready.
    MAX_DAILY_POSTS * 4,
  );
  return /^yes/i.test(answer.trim());
}

/**
 * Story-level dedup, one call per slot. Title similarity misses one event told
 * under different headlines ("OpenAI withdraws three mathematical results" and
 * "Terence Tao Responds to the OpenAI Math Drop" went out on consecutive days).
 * Returns the indexes of candidates that repeat a posted story or an earlier
 * candidate.
 */
export async function repeatedStories(
  candidates: string[],
  posted: string[],
): Promise<Set<number>> {
  if (candidates.length < 2 && posted.length === 0) return new Set();
  const answer = await call(
    [
      {
        role: 'user',
        content: `Which of these candidate headlines report the same news event, topic or announcement as an already posted headline, or as an earlier candidate in the list? Reactions, follow-ups and commentary on an event count as the same story.

Already posted:
${posted.map((t) => `- ${t}`).join('\n') || '- (none)'}

Candidates:
${candidates.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Answer with the candidate numbers to drop, comma-separated, or NONE. Nothing else.`,
      },
    ],
    2000,
    MAX_DAILY_POSTS * 2,
  );
  const out = new Set<number>();
  for (const m of answer.matchAll(/\d+/g)) {
    const n = Number(m[0]) - 1;
    if (n >= 0 && n < candidates.length) out.add(n);
  }
  return out;
}

export type Classification = {
  relevant: boolean;
  section: 'bigtech' | 'science' | 'programming' | 'yc';
  promo: boolean;
};

/**
 * The relevance gate. HN and the general-press feeds carry plenty that is not
 * tech news, and press feeds carry event promos; both must not reach the channel.
 * Runs on headlines only, before extraction, so it stays cheap.
 */
export async function classify(title: string, domain: string): Promise<Classification> {
  const answer = await call(
    [
      {
        role: 'user',
        content: `Classify this headline for a tech/software/AI news digest.

Headline: ${title}
Source: ${domain}

Answer with exactly three comma-separated values, nothing else:

1. RELEVANT or SKIP
   The audience is people who work in tech and are curious well beyond it:
   they read about games, design, history, science, language and odd corners of
   the world as readily as about frameworks. Think of the Hacker News front page.
   The test is "would someone like that open this?", NOT "is this tech news?".

   RELEVANT: technology, software, AI/ML, hardware, chips, developer tools,
   security, startups, tech-industry business; and equally — programming practice
   and architecture, engineering culture, software history and archaeology,
   design documents and post-mortems, teardowns and reverse engineering, games
   and game design, science and research of any field, mathematics, space,
   biology, linguistics and etymology, history, well-made explainers, essays,
   rants and opinion, curiosities and "huh, interesting" pieces.
   Be generous. Something that announces nothing, names no company and is thirty
   years old can still be RELEVANT.

   Buying guides, comparisons and explainers about technology are RELEVANT too
   ("Wired vs. wireless internet: which should you choose", "best NAS for home"):
   they are about the hardware and how it works.

   SKIP only: party politics and elections, legislative and regulatory process
   with no technology angle, celebrity and gossip, sport results, purely local
   news, health and wellness advice, discount and coupon round-ups.

2. One of: BIGTECH, SCIENCE, PROGRAMMING, YC
   BIGTECH = companies, products, funding, industry moves
   SCIENCE = research, models, papers, chips, hardware
   PROGRAMMING = languages, frameworks, tools, infrastructure, security
   YC = startup launches

3. PROMO or NEWS
   PROMO = advertising, conference ticket sales, sponsored content, newsletter
   self-promotion, "save $X", "last chance", job ads.

Example answer: RELEVANT, BIGTECH, NEWS`,
      },
    ],
    1000, // the cap includes reasoning; a tight one leaves no answer at all
  );

  // The answer may arrive with stray words around it; match rather than split blindly.
  const up = answer.toUpperCase();
  // "SKIP, ... not RELEVANT" must not read as relevant, so SKIP wins. With
  // neither word present, include: the scope rule says default to including.
  const rel = /\bSKIP\b/.test(up) ? 'SKIP' : 'RELEVANT';
  const sec = (up.match(/\b(BIGTECH|SCIENCE|PROGRAMMING|YC)\b/) ?? [])[1] ?? 'BIGTECH';
  const kind = /\bPROMO\b/.test(up) ? 'PROMO' : 'NEWS';
  const section =
    ({ BIGTECH: 'bigtech', SCIENCE: 'science', PROGRAMMING: 'programming', YC: 'yc' } as const)[
      sec as 'BIGTECH'
    ] ?? 'bigtech';

  return {
    relevant: rel?.startsWith('RELEVANT') ?? false,
    section,
    promo: kind?.startsWith('PROMO') ?? false,
  };
}
