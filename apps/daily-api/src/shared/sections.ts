/** The same four sections, in the same order, as the channel and the site. */
export const SECTIONS: [string, string][] = [
  ['bigtech', '🚀 BIG TECH & STARTUPS'],
  ['science', '🔬 SCIENCE & FUTURISTIC TECHNOLOGY'],
  ['programming', '⚙️ PROGRAMMING, DESIGN & DATA SCIENCE'],
  ['yc', '🆕 YC LAUNCHES'],
];

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
