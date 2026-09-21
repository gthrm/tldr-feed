// Model ids go stale fast. Run this at setup and whenever summaries look off.
const key = process.env.OPENAI_API_KEY;
const configured = process.env.OPENAI_MODEL ?? 'gpt-5.6-terra';
if (!key) {
  console.error('OPENAI_API_KEY is not set — put it in .env');
  process.exit(1);
}

const res = await fetch('https://api.openai.com/v1/models', {
  headers: { Authorization: `Bearer ${key}` },
  signal: AbortSignal.timeout(30000),
});
if (!res.ok) {
  console.error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  process.exit(1);
}

const ids: string[] = (await res.json()).data.map((m: any) => m.id).sort();
const chat = ids.filter((id) => /^(gpt|o\d)/.test(id) && !/audio|realtime|image|tts|whisper|embed/.test(id));

console.log(`configured: ${configured} — ${ids.includes(configured) ? 'available' : 'NOT AVAILABLE on this account'}`);
console.log(`\nchat-capable models on this account (${chat.length}):`);
for (const id of chat) console.log(`  ${id}${id === configured ? '   <- configured' : ''}`);
console.log('\nPricing is not in this API. Check https://developers.openai.com/api/docs/pricing');
console.log('before switching: the cheap tier is not always the one named "mini" or "nano".');
if (!ids.includes(configured)) process.exitCode = 1;
