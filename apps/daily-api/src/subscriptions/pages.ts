/**
 * The three pages a link click lands on. Served by the API rather than the
 * static site, so they carry their own styling — the same tokens as the site,
 * inlined, because there is no build step here to hash a stylesheet into.
 */
import { escapeHtml } from '../shared/sections.js';

const SHELL = (title: string, body: string, siteUrl: string): string => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>${escapeHtml(title)}</title>
<link href="https://fonts.googleapis.com/css?family=Roboto+Slab:700|Lato:400,700&display=swap" rel="stylesheet" />
<style>
  :root { color-scheme: light dark; --bg:#fff; --text:#222; --link:#ff5700; --meta:#bbb; }
  @media (prefers-color-scheme: dark) { :root { --bg:#2d2d2d; --text:#f2f2f3; --link:#f47e25; --meta:#8b8b8b; } }
  html { font: 118.75%/1.58 'Lato', sans-serif; }
  body { margin:0; background:var(--bg); color:var(--text); }
  main { max-width:700px; margin:0 auto; padding:3.16rem; }
  h1 { font-family:'Roboto Slab', serif; font-size:2rem; line-height:1.1; margin:0 0 1.58rem; }
  p { margin:0 0 1.58rem; }
  a { color:var(--link); text-decoration:none; }
  .meta { color:var(--meta); font-size:0.8rem; }
  @media (max-width:550px) { main { padding:1.58rem; } }
</style>
</head><body><main>
${body}
<p class="meta"><a href="${escapeHtml(siteUrl)}">← TLDR daily</a></p>
</main></body></html>`;

export const pageSubmitted = (siteUrl: string): string =>
  SHELL(
    'Check your inbox',
    `<h1>Check your inbox</h1>
     <p>A confirmation link is on its way. Nothing else is sent until you click it.</p>
     <p class="meta">Nothing arrived in a couple of minutes? Look in spam, then try again.</p>`,
    siteUrl,
  );

export const pageConfirmed = (siteUrl: string): string =>
  SHELL(
    'You are in',
    `<h1>You are in</h1>
     <p>The digest arrives once a day, in the evening. Every email carries a one-click unsubscribe.</p>`,
    siteUrl,
  );

export const pageUnsubscribed = (siteUrl: string): string =>
  SHELL(
    'Unsubscribed',
    `<h1>Unsubscribed</h1>
     <p>That address will get nothing more. It can be re-subscribed from the site at any time.</p>`,
    siteUrl,
  );

export const pageBadLink = (siteUrl: string): string =>
  SHELL(
    'That link does not work',
    `<h1>That link does not work</h1>
     <p>It may have been used already, or it belongs to an address that was removed.</p>`,
    siteUrl,
  );

export const pageBadEmail = (siteUrl: string): string =>
  SHELL(
    'That address looks wrong',
    `<h1>That address looks wrong</h1>
     <p>Go back and check the spelling, then try again.</p>`,
    siteUrl,
  );

export const pageTooMany = (siteUrl: string): string =>
  SHELL(
    'Too many attempts',
    `<h1>Too many attempts</h1>
     <p>Wait an hour and try again.</p>`,
    siteUrl,
  );
