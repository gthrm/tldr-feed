// Which stories earn the slot.
import type { Cluster } from './dedupe.ts';

/**
 * Recency dominates, source weight tilts, engagement and cross-source coverage
 * break ties. Coverage matters: five outlets on one story means it is real news.
 */
export function scoreCluster(c: Cluster, now = Date.now()): number {
  const head = c.items[0];

  const ageHours = head.publishedAt ? (now - head.publishedAt.getTime()) / 3.6e6 : 12;
  const recency = Math.exp(-Math.max(ageHours, 0) / 18); // half-life about 12h

  const weight = head.weight;
  const coverage = 1 + Math.log2(c.items.length); // 1 outlet -> 1, 4 outlets -> 3

  const points = Math.max(...c.items.map((i) => i.points ?? 0));
  const engagement = points > 0 ? 1 + Math.log10(points) / 2 : 1;

  return recency * weight * coverage * engagement;
}

export function rankClusters(clusters: Cluster[], now = Date.now()): Cluster[] {
  return [...clusters].sort((a, b) => scoreCluster(b, now) - scoreCluster(a, now));
}
