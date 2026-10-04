/* Telegram send helper — Vercel serverless
 * Auth: Google sign-in (see api/_lib/auth.js)
 * Env:
 *   TELEGRAM_BOT_TOKEN          — required
 *   TELEGRAM_CHAT_ID            — default chat (used when body.chatId is empty)
 *   TELEGRAM_ALLOWED_CHAT_IDS   — optional comma list of extra allowed chats
 * Body: { chatId?, text }
 * The bot can only post to chats on the server-side allowlist.
 */
import { requireUser } from './_lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = await requireUser(req, res);
  if (!user) return;

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
    const defaultChat = String(process.env.TELEGRAM_CHAT_ID || '').trim();
    const allowedChats = new Set(
      [defaultChat, ...String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || '').split(',')]
        .map((s) => s.trim())
        .filter(Boolean)
    );
    if (!allowedChats.size) {
      return res.status(500).json({
        error: 'TELEGRAM_CHAT_ID not configured',
        hint: 'Add TELEGRAM_CHAT_ID (and optionally TELEGRAM_ALLOWED_CHAT_IDS) in Vercel → Environment Variables → Redeploy'
      });
    }

    const chatId = String(body?.chatId || '').trim() || defaultChat;
    const text = body?.text;
    if (!text) {
      return res.status(400).json({ error: 'text required' });
    }
    if (!allowedChats.has(chatId)) {
      return res.status(403).json({
        error: 'Chat ID not allowed',
        code: 'TELEGRAM_CHAT_FORBIDDEN',
        hint: `Chat ${chatId} is not in TELEGRAM_CHAT_ID / TELEGRAM_ALLOWED_CHAT_IDS on the server.`
      });
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
      return res.status(502).json({ error: desc, hint });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Send failed' });
  }
}
