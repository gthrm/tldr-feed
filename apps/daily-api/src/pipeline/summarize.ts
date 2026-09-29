/**
 * Ported from the bot's pipeline: the same proven rules, running on their own.
 * A deliberate copy, not a shared dependency - the two apps share the source
 * list and nothing else, so neither can break the other.
 */
// TLDR-style summaries. The prompt is the one the model bake-off was run with;
// gpt-5.6-terra was chosen over gpt-5.6-luna because it picks the detail that
// matters rather than the first number it finds.
import type { Article } from './extract.js';

const MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.6-terra';
const API = 'https://api.openai.com/v1/chat/completions';

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

async function call(messages: ChatMessage[], maxTokens = 300): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');

  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
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
      // An empty completion means the token budget went on reasoning. Retrying
      // is the point of this loop — throwing here dropped the story on the
      // first occurrence instead of the fourth.
      const reason = body?.choices?.[0]?.finish_reason;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 1500));
        continue;
      }
      throw new Error(`OpenAI returned no content (finish_reason=${reason})`);
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
    50,
  );
  return /^yes/i.test(answer.trim());
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
    200, // a tight cap truncates the answer and the whole call fails
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
