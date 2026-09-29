/**
 * Ported from the bot's pipeline: the same proven rules, running on their own.
 * A deliberate copy, not a shared dependency - the two apps share the source
 * list and nothing else, so neither can break the other.
 */
// One story carried by five outlets must ship once.
// Stage 1 (identical canonical URL) is handled by the unique index in db.ts.
// This module is stage 2: deciding whether two different URLs are the same story.
import { normalizeTitle, entityTokens, type Item } from './normalize.js';

export const SIM_SAME = 0.55; // at or above: same story, no question
export const SIM_DIFFERENT = 0.4; // below: different stories
// between the two: ask the model, it is a handful of calls per slot

function trigrams(s: string): Set<string> {
  const padded = ` ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * Two signals, because neither alone is enough:
 * trigrams catch rewording, entity overlap catches the names that identify a story.
 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const tri = jaccard(trigrams(na), trigrams(nb));
  const ea = entityTokens(a);
  const eb = entityTokens(b);
  const ent = ea.size && eb.size ? jaccard(ea, eb) : 0;

  // Entities are the stronger signal but absent from some headlines, so they
  // lift the score rather than gate it.
  return ent > 0 ? tri * 0.6 + ent * 0.4 : tri;
}

export type Verdict = 'same' | 'different' | 'unsure';

export function compare(a: string, b: string): { score: number; verdict: Verdict } {
  const score = titleSimilarity(a, b);
  if (score >= SIM_SAME) return { score, verdict: 'same' };
  if (score >= SIM_DIFFERENT) return { score, verdict: 'unsure' };

  /*
   * Trigram similarity fails on one shape: a vendor announcing "Claude Sonnet
   * 5.5" and a newspaper writing "Anthropic releases Sonnet 5.5, which it calls
   * a significantly cheaper, faster work partner". The entity sets are
   * {claude, sonnet, 5.5} and {anthropic, sonnet, 5.5} — they share the product
   * and its version, but the length difference drags the score below the grey
   * band and the launch ships twice.
   *
   * A version number is the strongest identifier a headline carries, so two
   * shared entities where one of them contains a digit is worth the single
   * cheap question the model answers. One shared name is not: "Nvidia earnings"
   * and "Nvidia opens a Munich office" are two stories about one company.
   */
  const shared = [...entityTokens(a)].filter((t) => entityTokens(b).has(t));
  if (shared.length >= 2 && shared.some((t) => /\d/.test(t))) {
    return { score, verdict: 'unsure' };
  }

  return { score, verdict: 'different' };
}

export type Cluster = { key: string; items: Item[] };

/**
 * Group items into clusters of one story.
 * `resolveUnsure` decides the grey band; without it, unsure means different,
 * which keeps the pipeline working when the model is unavailable.
 */
export async function clusterItems(
  items: Item[],
  resolveUnsure?: (a: Item, b: Item) => Promise<boolean>,
): Promise<Cluster[]> {
  const clusters: Cluster[] = [];

  for (const item of items) {
    let placed = false;
    for (const cluster of clusters) {
      // compare against the cluster's representative only: O(n·clusters), and
      // members are by construction similar to it
      const head = cluster.items[0];
      const { verdict } = compare(item.title, head.title);
      const same =
        verdict === 'same' ||
        (verdict === 'unsure' && resolveUnsure ? await resolveUnsure(item, head) : false);
      if (same) {
        cluster.items.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ key: item.id, items: [item] });
  }

  // Representative: highest source weight, then the earliest published.
  for (const c of clusters) {
    c.items.sort(
      (x, y) =>
        y.weight - x.weight ||
        (x.publishedAt?.getTime() ?? Infinity) - (y.publishedAt?.getTime() ?? Infinity),
    );
    c.key = c.items[0].id;
  }
  return clusters;
}
