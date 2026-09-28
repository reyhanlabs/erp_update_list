/* Telegram send helper — Vercel serverless
 * Env: TELEGRAM_BOT_TOKEN
 * Body: { chatId, text }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return res.status(500).json({
      error: 'TELEGRAM_BOT_TOKEN not configured',
      hint: 'Vercel → Settings → Environment Variables → add TELEGRAM_BOT_TOKEN → Redeploy'
    });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    const chatId = body?.chatId;
    const text = body?.text;
    if (!chatId || !text) {
      return res.status(400).json({ error: 'chatId and text required' });
    }

    const msg = String(text).slice(0, 4000);
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        disable_web_page_preview: true
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) {
      const desc = data.description || 'Telegram API error';
      let hint = desc;
      if (/unauthorized/i.test(desc)) hint = 'Bot token invalid — check TELEGRAM_BOT_TOKEN';
      if (/chat not found/i.test(desc)) hint = 'Chat ID wrong, or bot not added to the group / not started with /start';
      if (/blocked/i.test(desc)) hint = 'Bot was blocked by the user';
      if (/parse/i.test(desc)) hint = 'Message format error';
      return res.status(502).json({ error: desc, hint, data });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Send failed' });
  }
}
