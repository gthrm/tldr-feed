// Reddit refuses anonymous clients: /.json answers 403, per-thread .rss carries
// only "submitted by", and old.reddit serves no post markup. The official API
// with an app-only token is the one path that actually returns the text.
import { UA } from './parse-feed.ts';

let token: { value: string; expires: number } | null = null;

async function getToken(): Promise<string | null> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;

  if (token && token.expires > Date.now() + 60_000) return token.value;

  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`reddit auth ${res.status}: ${(await res.text()).slice(0, 120)}`);

  const body: any = await res.json();
  token = { value: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return token.value;
}

/** Post title, selftext and the substantial top comments. '' when unconfigured. */
export async function fetchRedditThread(url: string): Promise<string> {
  const t = await getToken();
  if (!t) return '';

  const path = new URL(url).pathname.replace(/\/$/, '');
  const res = await fetch(`https://oauth.reddit.com${path}?limit=10&raw_json=1`, {
    headers: { Authorization: `Bearer ${t}`, 'User-Agent': UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`reddit api ${res.status}`);

  const body: any = await res.json();
  const post = body?.[0]?.data?.children?.[0]?.data;
  if (!post) return '';

  const comments: string[] = (body?.[1]?.data?.children ?? [])
    .map((c: any) => c?.data?.body)
    .filter((b: any) => typeof b === 'string' && b.length > 100)
    .slice(0, 5);

  // A link post has no selftext; the comments are then the whole substance.
  return [post.title, post.selftext, ...comments].filter(Boolean).join('\n\n');
}
