import fs from 'node:fs';

const indexPath = new URL('../index.js', import.meta.url);
let source = fs.readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n');

if (source.includes("app.post('/webhook/dokploy'")) {
  console.log('Dokploy webhook đã tồn tại trong index.js');
  process.exit(0);
}

const marker = `// ----------------------------------------------------
// Telegraf Bot Setup`;

if (!source.includes(marker)) {
  throw new Error('Không tìm thấy vị trí thêm Dokploy webhook');
}

const implementation = String.raw`// Dokploy deployment notification webhook
const DOKPLOY_WEBHOOK_SECRET = String(process.env.DOKPLOY_WEBHOOK_SECRET || '').trim();

function getDokployWebhookSecret(req) {
  const authorization = String(req.get('authorization') || '').trim();
  if (/^Bearer\s+/i.test(authorization)) {
    return authorization.replace(/^Bearer\s+/i, '').trim();
  }

  return String(
    req.get('x-dokploy-secret') ||
    req.get('x-webhook-secret') ||
    ''
  ).trim();
}

function isValidDokploySecret(providedSecret) {
  if (!DOKPLOY_WEBHOOK_SECRET || !providedSecret) return false;

  const crypto = require('crypto');
  const expected = Buffer.from(DOKPLOY_WEBHOOK_SECRET);
  const provided = Buffer.from(String(providedSecret));

  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

function normalizeDokployDomains(value) {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split(',');

  return [...new Set(
    items
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )];
}

function getSafeHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch (_) {
    return null;
  }
}

function formatDokployTimestamp(value) {
  const parsed = new Date(value || Date.now());
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

async function sendDokployTelegramNotification(message, replyMarkup) {
  const options = { parse_mode: 'HTML' };
  if (replyMarkup?.inline_keyboard?.length) {
    options.reply_markup = replyMarkup;
  }

  const deliveryResults = await Promise.allSettled(
    ADMIN_CHAT_IDS.map((chatId) => bot.telegram.sendMessage(chatId, message, options))
  );

  const failures = deliveryResults
    .map((result, index) => ({ result, chatId: ADMIN_CHAT_IDS[index] }))
    .filter(({ result }) => result.status === 'rejected');

  failures.forEach(({ result, chatId }) => {
    console.error(
      'Failed to send Dokploy notification to chat ' + chatId + ':',
      result.reason?.message || result.reason
    );
  });

  if (failures.length === deliveryResults.length) {
    throw failures[0]?.result?.reason || new Error('Không gửi được thông báo Dokploy');
  }

  return {
    sent: deliveryResults.length - failures.length,
    failed: failures.length
  };
}

app.post('/webhook/dokploy', async (req, res) => {
  if (!DOKPLOY_WEBHOOK_SECRET) {
    console.error('DOKPLOY_WEBHOOK_SECRET chưa được cấu hình');
    return res.status(503).json({ error: 'Dokploy webhook is not configured' });
  }

  if (!isValidDokploySecret(getDokployWebhookSecret(req))) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  const payload = req.body || {};
  const title = String(payload.title || '').trim();
  const messageText = String(payload.message || '').trim();
  const status = String(payload.status || '').trim().toLowerCase();
  const type = String(payload.type || '').trim().toLowerCase();
  const isTest = /^test notification$/i.test(title);
  const isSuccessfulBuild = status === 'success' && (!type || type === 'build');

  if (!isTest && !isSuccessfulBuild) {
    return res.status(202).json({ success: true, ignored: true });
  }

  try {
    if (isTest) {
      const delivery = await sendDokployTelegramNotification([
        '🧪 <b>Kết nối Dokploy thành công</b>',
        '',
        escapeHtml(messageText || 'Webhook đã sẵn sàng nhận thông báo deployment.')
      ].join('\n'));

      return res.status(200).json({ success: true, test: true, ...delivery });
    }

    const projectName = String(payload.projectName || 'Không rõ').trim();
    const applicationName = String(payload.applicationName || 'Không rõ').trim();
    const applicationType = String(payload.applicationType || 'Không rõ').trim();
    const environmentName = String(payload.environmentName || '').trim();
    const buildLink = getSafeHttpUrl(payload.buildLink);
    const domains = normalizeDokployDomains(payload.domains);
    const timestamp = formatDokployTimestamp(payload.timestamp || payload.date);

    const lines = [
      '✅ <b>Dokploy deployment thành công</b>',
      '',
      '• <b>Project:</b> ' + escapeHtml(projectName),
      '• <b>Application:</b> ' + escapeHtml(applicationName),
      ...(environmentName ? ['• <b>Environment:</b> ' + escapeHtml(environmentName)] : []),
      '• <b>Type:</b> ' + escapeHtml(applicationType),
      ...(domains.length ? ['• <b>Domain:</b> ' + escapeHtml(domains.join(', '))] : []),
      '• <b>Hoàn tất:</b> ' + escapeHtml(timestamp)
    ];

    const buttons = [];
    if (buildLink) {
      buttons.push([{ text: '📋 Mở deployment logs', url: buildLink }]);
    }

    const domainButtons = domains
      .map((domain) => {
        const normalized = /^https?:\/\//i.test(domain) ? domain : 'https://' + domain;
        const url = getSafeHttpUrl(normalized);
        return url ? { text: '🌐 ' + domain.replace(/^https?:\/\//i, ''), url } : null;
      })
      .filter(Boolean)
      .slice(0, 4);

    for (let i = 0; i < domainButtons.length; i += 2) {
      buttons.push(domainButtons.slice(i, i + 2));
    }

    const delivery = await sendDokployTelegramNotification(
      lines.join('\n'),
      buttons.length ? { inline_keyboard: buttons } : undefined
    );

    console.log(
      'Sent Dokploy deployment notification for ' + applicationName +
      ' to ' + delivery.sent + ' Telegram chat(s)'
    );

    return res.status(200).json({ success: true, ...delivery });
  } catch (error) {
    console.error('Failed to process Dokploy webhook:', error.message);
    return res.status(500).json({
      error: 'Failed to send Dokploy Telegram notification: ' + error.message
    });
  }
});

`;

source = source.replace(marker, implementation + marker);
fs.writeFileSync(indexPath, source, 'utf8');
console.log('Đã tích hợp Dokploy deployment webhook vào index.js');
