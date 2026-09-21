// Publishing. Telegram is strict about rate limits and tells us how long to wait.
const API = 'https://api.telegram.org';

export async function sendMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHANNEL_ID;
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID is not set');

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (res.ok) return;

    const body = (await res.json().catch(() => ({}))) as {
      description?: string;
      parameters?: { retry_after?: number };
    };
    if (res.status === 429) {
      const wait = (body.parameters?.retry_after ?? 5) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (res.status >= 500) {
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
      continue;
    }
    throw new Error(`Telegram ${res.status}: ${body.description ?? 'unknown error'}`);
  }
  throw new Error('Telegram: retries exhausted');
}
