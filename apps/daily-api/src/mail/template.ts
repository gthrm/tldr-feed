/**
 * The email is built with MJML, which writes the table markup Outlook needs.
 * Colours are inlined and light-only: mail clients do not support CSS variables,
 * and Gmail strips most of a <style> block.
 */
import mjml2html from 'mjml';
import { SECTIONS, escapeHtml } from '../shared/sections.js';

export type MailEntry = {
  slot: string;
  section: string;
  title: string;
  url: string;
  domain: string;
  summary: string;
  minutes: number;
};

export type DigestMail = { subject: string; html: string; text: string };

const LINK = '#ff5700';
const TEXT = '#222222';
const META = '#8a8a8a';
const FONT = "'Lato', Helvetica, Arial, sans-serif";
const HEAD_FONT = "'Roboto Slab', Georgia, 'Times New Roman', serif";

function story(e: MailEntry): string {
  return `
    <mj-text padding="0 0 6px" font-family="${HEAD_FONT}" font-size="20px" font-weight="700" line-height="1.25">
      <a href="${escapeHtml(e.url)}" style="color:${TEXT};text-decoration:none">${escapeHtml(e.title)}</a>
      <span style="color:${META};font-family:${FONT};font-size:13px;font-weight:400"> — ${escapeHtml(e.slot)}</span>
    </mj-text>
    <mj-text padding="0 0 4px" font-family="${FONT}" font-size="15px" line-height="1.55" color="${TEXT}">
      ${escapeHtml(e.summary)}
    </mj-text>
    <mj-text padding="0 0 22px" font-family="${FONT}" font-size="12px" color="${META}">
      ${escapeHtml(e.domain)} · ${e.minutes} min read
    </mj-text>`;
}

export async function renderDigest(opts: {
  day: string;
  dayTitle: string;
  entries: MailEntry[];
  siteUrl: string;
  dayPath: string;
  unsubscribeUrl: string;
}): Promise<DigestMail> {
  const { dayTitle, entries, siteUrl, dayPath, unsubscribeUrl } = opts;

  const sections = SECTIONS.map(([key, label]) => {
    const inSection = entries.filter((e) => e.section === key);
    if (!inSection.length) return '';
    return `
    <mj-text padding="18px 0 12px" font-family="${FONT}" font-size="13px" font-weight="700" letter-spacing="0.03em" color="${TEXT}">
      ${escapeHtml(label)}
    </mj-text>
    ${inSection.map(story).join('')}`;
  }).join('');

  const { html, errors } = await mjml2html(`
<mjml>
  <mj-head>
    <mj-preview>${escapeHtml(entries[0]?.title ?? dayTitle)}</mj-preview>
    <mj-attributes><mj-all font-family="${FONT}" /></mj-attributes>
  </mj-head>
  <mj-body background-color="#ffffff" width="680px">
    <mj-section padding="24px 0 0">
      <mj-column>
        <mj-text font-family="${HEAD_FONT}" font-size="22px" font-weight="700" color="${TEXT}" padding="0 0 4px">
          TLDR daily
        </mj-text>
        <mj-text font-family="${FONT}" font-size="14px" color="${META}" padding="0 0 12px">
          ${escapeHtml(dayTitle)} · ${entries.length} stories
        </mj-text>
        <mj-divider border-width="1px" border-color="#eeeeee" padding="0 0 8px" />
        ${sections}
        <mj-divider border-width="1px" border-color="#eeeeee" padding="12px 0" />
        <mj-text font-family="${FONT}" font-size="12px" color="${META}" padding="0 0 4px">
          <a href="${escapeHtml(siteUrl)}${escapeHtml(dayPath)}" style="color:${LINK};text-decoration:none">Read this day on the web</a>
        </mj-text>
        <mj-text font-family="${FONT}" font-size="12px" color="${META}" padding="0 0 24px">
          <a href="${escapeHtml(unsubscribeUrl)}" style="color:${META};text-decoration:underline">Unsubscribe</a>
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`);

  if (errors?.length) {
    throw new Error(
      `MJML: ${errors.map((e) => e.formattedMessage).join('; ')}`,
    );
  }

  const text = [
    `TLDR daily — ${dayTitle}`,
    '',
    ...SECTIONS.flatMap(([key, label]) => {
      const inSection = entries.filter((e) => e.section === key);
      if (!inSection.length) return [];
      return [
        label,
        '',
        ...inSection.flatMap((e) => [
          `${e.title} (${e.minutes} min read)`,
          e.summary,
          `${e.domain} — ${e.url}`,
          '',
        ]),
      ];
    }),
    `Read on the web: ${siteUrl}${dayPath}`,
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join('\n');

  return { subject: `TLDR daily — ${dayTitle}`, html, text };
}

export async function renderConfirm(opts: {
  confirmUrl: string;
  siteUrl: string;
}): Promise<DigestMail> {
  const { html, errors } = await mjml2html(`
<mjml>
  <mj-body background-color="#ffffff" width="680px">
    <mj-section padding="24px 0">
      <mj-column>
        <mj-text font-family="${HEAD_FONT}" font-size="22px" font-weight="700" color="${TEXT}" padding="0 0 12px">
          One click and you are in
        </mj-text>
        <mj-text font-family="${FONT}" font-size="15px" color="${TEXT}" line-height="1.55" padding="0 0 16px">
          Confirm that this address asked for TLDR daily. Nothing is sent until you do,
          and if this was not you, ignore this email — no other message will follow.
        </mj-text>
        <mj-button background-color="${LINK}" color="#ffffff" font-family="${FONT}" font-size="15px" border-radius="3px" href="${escapeHtml(opts.confirmUrl)}">
          Confirm subscription
        </mj-button>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`);
  if (errors?.length)
    throw new Error(
      `MJML: ${errors.map((e) => e.formattedMessage).join('; ')}`,
    );

  return {
    subject: 'Confirm your TLDR daily subscription',
    html,
    text: `Confirm that this address asked for TLDR daily:\n\n${opts.confirmUrl}\n\nIf this was not you, ignore this email.`,
  };
}
