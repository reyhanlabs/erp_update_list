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
      hint: 'Add TELEGRAM_BOT_TOKEN in Vercel env, then redeploy.'
    });
  }

  try {
    const { chatId, text } = req.body || {};
    if (!chatId || !text) {
      return res.status(400).json({ error: 'chatId and text required' });
    }
    const body = String(text).slice(0, 4000);
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: body,
        disable_web_page_preview: true
      })
    });
    const data = await r.json();
    if (!r.ok || !data.ok) {
      return res.status(502).json({ error: data.description || 'Telegram API error', data });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Send failed' });
  }
}
