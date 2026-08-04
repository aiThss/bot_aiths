const express = require('express');
const { Telegraf } = require('telegraf');
const axios = require('axios');
const cheerio = require('cheerio');
const dns = require('dns');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// DNS configuration
// Dùng DNS mặc định của hệ điều hành. Custom lookup cũ không xử lý options.all,
// khiến Node nhận địa chỉ IP undefined trên một số request HTTPS.
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (_) {
  // Node cũ không hỗ trợ API này; có thể bỏ qua.
}

// Validate required environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const ADMIN_CHAT_IDS = [...new Set(
  [process.env.ADMIN_CHAT_ID, process.env.ADMIN_CHAT_IDS]
    .filter(Boolean)
    .join(',')
    .split(/[,;\s]+/)
    .map((value) => value.trim())
    .filter((value) => /^-?\d+$/.test(value))
)];

if (!BOT_TOKEN || ADMIN_CHAT_IDS.length === 0) {
  console.error('CRITICAL: BOT_TOKEN and at least one ADMIN_CHAT_ID or ADMIN_CHAT_IDS value must be set.');
  process.exit(1);
}

// Optional Google Custom Search Keys
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID;

// ----------------------------------------------------
// Express Setup
// ----------------------------------------------------
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

// Webhook endpoint for Dokploy notifications
app.post('/webhook/dokploy', async (req, res) => {
  const rawBody = req.body || {};
  console.log('Received Dokploy webhook payload:', JSON.stringify(rawBody, null, 2));

  const title = rawBody.title || rawBody.event || rawBody.appName || (rawBody.status ? `Dokploy ${rawBody.status}` : undefined);
  const message = rawBody.message || rawBody.description || rawBody.text || rawBody.details || (typeof rawBody === 'object' && Object.keys(rawBody).length > 0 ? JSON.stringify(rawBody) : '');
  const timestamp = rawBody.timestamp || rawBody.createdAt || rawBody.date;

  // Extract App/Project/Service name from payload or query params
  const appName = req.query.appName || req.query.serviceName || rawBody.appName || rawBody.applicationName || rawBody.serviceName || rawBody.projectName || rawBody.name || rawBody.application?.name || rawBody.project?.name || null;

  // Extract Website/App URL from payload or query params
  let appUrl = req.query.appUrl || req.query.url || rawBody.url || rawBody.appUrl || rawBody.applicationUrl || rawBody.domain || rawBody.host || rawBody.application?.url || null;

  // Fallback: search for http/https URL in message or description if not explicitly provided
  if (!appUrl && typeof message === 'string') {
    const urlMatch = message.match(/https?:\/\/[^\s"'<>]+/i);
    if (urlMatch) {
      appUrl = urlMatch[0];
    }
  }

  if (!title && !message) {
    return res.status(400).json({ error: 'Missing title and message in payload' });
  }

  try {
    let timeStr = '';
    try {
      const date = timestamp ? new Date(timestamp) : new Date();
      timeStr = date.toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok' });
    } catch (_) {
      timeStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok' });
    }

    const fullText = `${title || ''} ${message || ''} ${rawBody.status || ''} ${rawBody.event || ''}`.toLowerCase();
    const isSuccess = /success|thành công|done|ok|completed/i.test(fullText);
    const isError = /fail|error|lỗi|failed|err/i.test(fullText);

    let icon = 'ℹ️';
    let statusLabel = title ? escapeHtml(title) : 'Thông báo Dokploy';

    if (isSuccess && !isError) {
      icon = '✅';
    } else if (isError) {
      icon = '❌';
    } else if (/restart|khởi động/i.test(fullText)) {
      icon = '🔄';
    } else if (/backup|sao lưu/i.test(fullText)) {
      icon = '💾';
    } else if (/cleanup|dọn dẹp/i.test(fullText)) {
      icon = '🧹';
    }

    let telegramMessage = `${icon} <b>[Dokploy Deployment]</b> ${statusLabel}\n\n`;

    if (appName) {
      telegramMessage += `📦 <b>Dự án / Service:</b> <code>${escapeHtml(appName)}</code>\n`;
    }

    const formattedMessage = message ? escapeHtml(message) : '';
    if (formattedMessage && formattedMessage !== statusLabel) {
      telegramMessage += `📝 <b>Chi tiết:</b>\n${formattedMessage}\n\n`;
    }

    telegramMessage += `🕒 <b>Thời gian:</b> ${timeStr}`;

    const telegramOptions = { parse_mode: 'HTML' };
    if (appUrl && /^https?:\/\//i.test(appUrl)) {
      telegramOptions.reply_markup = {
        inline_keyboard: [[
          { text: '🌐 Mở Website', url: appUrl }
        ]]
      };
    }

    const queryChatId = req.query.chatId || req.query.chat_id;
    const targetChatIds = queryChatId
      ? [queryChatId]
      : (typeof ADMIN_CHAT_IDS !== 'undefined' && ADMIN_CHAT_IDS.length > 0 ? ADMIN_CHAT_IDS : [ADMIN_CHAT_ID]);

    const deliveryResults = await Promise.allSettled(
      targetChatIds.map(async (chatId) => {
        try {
          return await bot.telegram.sendMessage(chatId, telegramMessage, telegramOptions);
        } catch (err) {
          const plainMessage = `${icon} [Dokploy] ${title || 'Thông báo'}\n` +
            (appName ? `Dự án: ${appName}\n` : '') +
            `Chi tiết: ${message || ''}\nThời gian: ${timeStr}` +
            (appUrl ? `\nLink: ${appUrl}` : '');
          return await bot.telegram.sendMessage(chatId, plainMessage);
        }
      })
    );

    const failedDeliveries = deliveryResults.filter(r => r.status === 'rejected');
    if (failedDeliveries.length === targetChatIds.length) {
      const errorReason = failedDeliveries[0]?.reason?.message || 'Chat not found or bot not started';
      console.error('Dokploy Webhook failed for all recipients:', errorReason);
      return res.status(500).json({ error: `Failed to send Telegram notification: ${errorReason}` });
    }

    return res.status(200).json({ success: true, message: 'Notification sent to Telegram' });
  } catch (error) {
    console.error('Failed to send Dokploy notification to Telegram:', error.message);
    return res.status(500).json({ error: 'Failed to send Telegram notification: ' + error.message });
  }
});


// Webhook notification endpoint
function normalizeActionLabel(value) {
  return /^Lấy$/i.test(String(value || '').trim()) ? 'Lấy' : 'Gửi';
}

function formatDepositTime(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return String(value || 'Không rõ');
  return match[1].padStart(2, '0') + 'h' + match[2];
}

function formatDepositDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value || 'Không rõ');
  return match[3] + '/' + match[2] + '/' + match[1];
}

function getLegacyDepositDate(id) {
  let date = new Date();
  if (/^[0-9a-f]{24}$/i.test(String(id || ''))) {
    const seconds = Number.parseInt(String(id).slice(0, 8), 16);
    if (Number.isFinite(seconds)) date = new Date(seconds * 1000);
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const getPart = (type) => parts.find((part) => part.type === type)?.value || '';
  return getPart('year') + '-' + getPart('month') + '-' + getPart('day');
}

function getPinballAppUrl() {
  const configuredUrl = String(process.env.PINBALL_APP_URL || '').trim();
  const candidates = [configuredUrl, 'https://pinball.babyress.games'].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url;
    } catch (_) {
      // Thử URL mặc định nếu biến môi trường bị nhập sai.
    }
  }

  throw new Error('PINBALL_APP_URL không hợp lệ');
}

function buildPinballActionKeyboard(id) {
  const recordId = String(id || '').trim();
  if (!/^[0-9a-f]{24}$/i.test(recordId)) return {};

  const miniAppUrl = new URL('/telegram/record', getPinballAppUrl());
  miniAppUrl.searchParams.set('record', recordId);

  return {
    reply_markup: {
      inline_keyboard: [[
        { text: '✏️ Cập nhật', web_app: { url: miniAppUrl.href } },
        { text: '🗑️ Xoá bản ghi', callback_data: 'pb:del:' + recordId }
      ]]
    }
  };
}

function buildPinballDeleteConfirmKeyboard(id) {
  return {
    inline_keyboard: [[
      { text: 'Huỷ', callback_data: 'pb:no:' + id },
      { text: 'Xác nhận xoá', callback_data: 'pb:yes:' + id }
    ]]
  };
}

function isAuthorizedPinballAdmin(ctx) {
  const userId = String(ctx.from?.id || '');
  const chatId = String(ctx.chat?.id || '');
  return Boolean(
    userId &&
    chatId &&
    (ADMIN_CHAT_IDS.includes(userId) || ADMIN_CHAT_IDS.includes(chatId))
  );
}

function describePinballApiError(error) {
  const responseMessage = error?.response?.data?.message || error?.response?.data?.error;
  return responseMessage || error?.message || 'Không thể kết nối tới Pinball.';
}

async function deletePinballRecord(id) {
  const endpoint = new URL('/api/bot/deposits/' + id, getPinballAppUrl());
  return axios.delete(endpoint.href, {
    headers: { Authorization: 'Bearer ' + BOT_TOKEN },
    timeout: 15000
  });
}

function parsePinballTotalText(value) {
  const match = String(value || '').match(/Thẻ:\s*(\d+)\s*\|\s*Bi:\s*(\d+)/i);
  if (!match) return null;

  return {
    cards: Number.parseInt(match[1], 10),
    balls: Number.parseInt(match[2], 10)
  };
}

function getPinballTotalsFromPayload(payload) {
  const totalText = parsePinballTotalText(payload.totalText);
  if (totalText) return totalText;

  const cards = Number(payload.totalCards);
  const balls = Number(payload.totalBalls);
  if (Number.isInteger(cards) && cards >= 0 && Number.isInteger(balls) && balls >= 0) {
    return { cards, balls };
  }

  return null;
}

async function fetchPinballCustomerTotals(payload) {
  const payloadTotals = getPinballTotalsFromPayload(payload);
  if (payloadTotals) return payloadTotals;

  const phone = String(payload.phone || '').trim();
  if (!phone) return null;

  try {
    const endpoint = new URL('/api/deposits', getPinballAppUrl());
    endpoint.searchParams.set('phone', phone);
    endpoint.searchParams.set('limit', '1');

    const response = await axios.get(endpoint.href, { timeout: 15000 });
    const deposits = Array.isArray(response.data?.deposits) ? response.data.deposits : [];
    if (deposits.length === 0) return { cards: 0, balls: 0 };

    return parsePinballTotalText(deposits[0]?.totalText);
  } catch (error) {
    console.error('Failed to fetch Pinball customer totals:', error.message);
    return null;
  }
}

function formatPinballTotalLine(totals) {
  if (!totals) return '• <b>Tổng:</b> Không lấy được số dư';
  return '• <b>Tổng:</b> ' + totals.cards + ' thẻ + ' + totals.balls + ' bi';
}

app.post('/webhook/pinball', async (req, res) => {
  const payload = req.body || {};
  const hasStructuredPayload = Boolean(
    payload.fullName &&
    payload.phone &&
    payload.actorName &&
    payload.depositTime &&
    payload.depositDate
  );
  const hasLegacyPayload = Boolean(payload.id && payload.title && payload.type);

  if (!hasStructuredPayload && !hasLegacyPayload) {
    return res.status(400).json({ error: 'Missing required Pinball webhook fields' });
  }

  try {
    const actionGroups = { 'Gửi': [], 'Lấy': [] };
    let customerName;
    let phone;
    let staffName;
    let depositTime;
    let depositDate;

    if (hasStructuredPayload) {
      customerName = String(payload.fullName).trim();
      phone = String(payload.phone).trim();
      staffName = String(payload.actorName).trim();
      depositTime = String(payload.depositTime).trim();
      depositDate = String(payload.depositDate).trim();

      const cards = Number(payload.cards || 0);
      const balls = Number(payload.balls || 0);
      if (cards > 0) actionGroups[normalizeActionLabel(payload.cardAction)].push(String(cards) + ' thẻ');
      if (balls > 0) actionGroups[normalizeActionLabel(payload.ballAction)].push(String(balls) + ' bi');
    } else {
      const title = String(payload.title);
      const type = String(payload.type);
      const customerMatch = title.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
      const detailMatch = type.match(/^(.*?)\s*\(Bởi\s+(.*?)\s+lúc\s+([^)]+)\)\s*$/i);

      customerName = customerMatch ? customerMatch[1].trim() : title.trim();
      phone = customerMatch ? customerMatch[2].trim() : 'Không rõ';
      staffName = detailMatch ? detailMatch[2].trim() : 'Không rõ';
      depositTime = detailMatch ? detailMatch[3].trim() : 'Không rõ';
      depositDate = getLegacyDepositDate(payload.id);

      const rawAction = detailMatch ? detailMatch[1].trim() : type.trim();
      rawAction.split(/\s*\+\s*/).forEach((part) => {
        const actionMatch = part.match(/^(Gửi|Lấy)\s+(.+)$/i);
        const label = actionMatch ? normalizeActionLabel(actionMatch[1]) : 'Gửi';
        const item = (actionMatch ? actionMatch[2] : part).trim();
        if (item) actionGroups[label].push(item);
      });
    }

    const actionLines = ['Gửi', 'Lấy']
      .filter((label) => actionGroups[label].length > 0)
      .map((label) => '• <b>' + label + ':</b> ' + escapeHtml(actionGroups[label].join(', ')));

    if (actionLines.length === 0) actionLines.push('• <b>Thao tác:</b> Không thay đổi thẻ hoặc bi');

    const customerTotals = await fetchPinballCustomerTotals({ ...payload, phone });

    const message = [
      '🔔 <b>Thông báo mới từ Pinball!</b>',
      '',
      '• <b>Tên khách hàng:</b> ' + escapeHtml(customerName),
      '• <b>Số điện thoại:</b> ' + escapeHtml(phone),
      ...actionLines,
      formatPinballTotalLine(customerTotals),
      '• <b>Nhân viên:</b> ' + escapeHtml(staffName) +
        ' tạo lúc ' + escapeHtml(formatDepositTime(depositTime)) +
        ' ' + escapeHtml(formatDepositDate(depositDate))
    ].join('\n');

    console.log('Received Pinball webhook for ' + phone);
    const telegramOptions = { parse_mode: 'HTML', ...buildPinballActionKeyboard(payload.id) };
    const deliveryResults = await Promise.allSettled(
      ADMIN_CHAT_IDS.map((chatId) => bot.telegram.sendMessage(chatId, message, telegramOptions))
    );
    const failedDeliveries = deliveryResults
      .map((result, index) => ({ result, chatId: ADMIN_CHAT_IDS[index] }))
      .filter(({ result }) => result.status === 'rejected');

    failedDeliveries.forEach(({ result, chatId }) => {
      console.error('Failed to send Pinball notification to chat ' + chatId + ':', result.reason?.message || result.reason);
    });

    if (failedDeliveries.length === ADMIN_CHAT_IDS.length) {
      throw failedDeliveries[0].result.reason;
    }
    return res.status(200).json({ success: true, message: 'Notification sent to admin' });
  } catch (error) {
    console.error('Failed to send webhook notification to admin:', error.message);
    return res.status(500).json({ error: 'Failed to send Telegram notification: ' + error.message });
  }
});

// ----------------------------------------------------
// Telegraf Bot Setup
// ----------------------------------------------------
const bot = new Telegraf(BOT_TOKEN);

const PINBALL_REPORT_TIME_ZONE = 'Asia/Bangkok';
const PINBALL_REPORT_HOUR = 22;
const PINBALL_REPORT_RETRY_DELAY_MS = 5 * 60 * 1000;
const PINBALL_REPORT_STATE_FILE = process.env.PINBALL_REPORT_STATE_FILE ||
  '/app/data/pinball-daily-report-state.json';
let dailyPinballReportTimer = null;

function getPinballReportDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PINBALL_REPORT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const getPart = (type) => parts.find((part) => part.type === type)?.value || '';

  return {
    date: getPart('year') + '-' + getPart('month') + '-' + getPart('day'),
    displayDate: getPart('day') + '/' + getPart('month') + '/' + getPart('year')
  };
}

function getNextDailyPinballReportDelay(now = new Date()) {
  const { date } = getPinballReportDateParts(now);
  const target = new Date(date + 'T' + String(PINBALL_REPORT_HOUR).padStart(2, '0') + ':00:00+07:00');

  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }

  return Math.max(1000, target.getTime() - now.getTime());
}

function getPinballReportDeadline(date) {
  return new Date(
    date + 'T' + String(PINBALL_REPORT_HOUR).padStart(2, '0') + ':00:00+07:00'
  );
}

function getPreviousPinballReportDate(date) {
  return getPinballReportDateParts(
    new Date(getPinballReportDeadline(date).getTime() - 24 * 60 * 60 * 1000)
  ).date;
}

function getMostRecentlyCompletedPinballReportDate(now = new Date()) {
  const { date } = getPinballReportDateParts(now);
  return now.getTime() >= getPinballReportDeadline(date).getTime()
    ? date
    : getPreviousPinballReportDate(date);
}

function readDailyPinballReportState() {
  try {
    const rawState = fs.readFileSync(PINBALL_REPORT_STATE_FILE, 'utf8');
    const state = JSON.parse(rawState);
    return /^\d{4}-\d{2}-\d{2}$/.test(String(state?.lastSentDate || ''))
      ? { lastSentDate: state.lastSentDate }
      : {};
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Could not read Pinball report state:', error.message);
    }
    return {};
  }
}

function saveDailyPinballReportState(state) {
  const directory = path.dirname(PINBALL_REPORT_STATE_FILE);
  const temporaryFile = PINBALL_REPORT_STATE_FILE + '.tmp';

  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(temporaryFile, JSON.stringify(state) + '\n', 'utf8');
  fs.renameSync(temporaryFile, PINBALL_REPORT_STATE_FILE);
}

async function sendMissedDailyPinballReportIfNeeded(now = new Date()) {
  const date = getMostRecentlyCompletedPinballReportDate(now);
  const state = readDailyPinballReportState();

  if (state.lastSentDate === date) {
    console.log('Daily Pinball report for ' + date + ' was already sent.');
    return null;
  }

  const report = await sendDailyPinballReport(date);
  saveDailyPinballReportState({ lastSentDate: date });
  return report;
}

function formatDailyPinballReports(report) {
  const summary = [
    '📊 <b>Báo cáo Pinball ngày ' + escapeHtml(formatDepositDate(report.date)) + '</b>',
    '',
    '• Khách đã gửi: <b>' + report.uniqueCustomers + '</b>',
    '• Lượt ghi nhận: <b>' + report.totalRecords + '</b>',
    '• Tổng thẻ gửi: <b>' + report.cardsDeposited + '</b>',
    '• Tổng bi gửi: <b>' + report.ballsDeposited + '</b>',
    '',
    '<b>Chi tiết khách:</b>'
  ].join('\n');
  const customerLines = report.customers.map((customer) =>
    '• ' + escapeHtml(customer.fullName) + ': <b>' + customer.cardsDeposited + '</b> thẻ, <b>' + customer.ballsDeposited + '</b> bi'
  );

  if (customerLines.length === 0) return [summary + '\n• Không có lượt gửi'];

  const messages = [];
  let message = summary;
  customerLines.forEach((line) => {
    if ((message + '\n' + line).length > 3900) {
      messages.push(message);
      message = '<b>Chi tiết khách (tiếp):</b>\n' + line;
      return;
    }
    message += '\n' + line;
  });
  messages.push(message);
  return messages;
}

async function fetchDailyPinballReport(date) {
  const endpoint = new URL('/api/bot/daily-report', getPinballAppUrl());
  endpoint.searchParams.set('date', date);
  const response = await axios.get(endpoint.href, {
    headers: { Authorization: 'Bearer ' + BOT_TOKEN },
    timeout: 15000
  });

  const report = response.data || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(report.date || ''))) {
    throw new Error('Pinball trả về dữ liệu báo cáo không hợp lệ.');
  }

  return {
    date: report.date,
    totalRecords: Number(report.totalRecords) || 0,
    uniqueCustomers: Number(report.uniqueCustomers) || 0,
    cardsDeposited: Number(report.cardsDeposited) || 0,
    ballsDeposited: Number(report.ballsDeposited) || 0,
    customers: Array.isArray(report.customers)
      ? report.customers.map((customer) => ({
        fullName: String(customer?.fullName || 'Không rõ'),
        cardsDeposited: Number(customer?.cardsDeposited) || 0,
        ballsDeposited: Number(customer?.ballsDeposited) || 0
      }))
      : []
  };
}

async function sendDailyPinballReport(date = getPinballReportDateParts().date) {
  const report = await fetchDailyPinballReport(date);
  const messages = formatDailyPinballReports(report);
  const results = await Promise.allSettled(
    ADMIN_CHAT_IDS.map(async (chatId) => {
      for (const message of messages) {
        await bot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' });
      }
    })
  );
  const failed = results.filter((result) => result.status === 'rejected');

  failed.forEach((result) => {
    console.error('Failed to send daily Pinball report:', result.reason?.message || result.reason);
  });

  if (failed.length === ADMIN_CHAT_IDS.length) {
    throw failed[0].reason;
  }

  console.log('Sent daily Pinball report for ' + date);
  return report;
}

function scheduleDailyPinballReport(delay = getNextDailyPinballReportDelay()) {
  if (dailyPinballReportTimer) clearTimeout(dailyPinballReportTimer);
  console.log('Daily Pinball report scheduled in ' + Math.round(delay / 1000) + ' seconds');

  dailyPinballReportTimer = setTimeout(async () => {
    try {
      await sendMissedDailyPinballReportIfNeeded();
    } catch (error) {
      console.error('Failed to send daily Pinball report:', describePinballApiError(error));
      return scheduleDailyPinballReport(PINBALL_REPORT_RETRY_DELAY_MS);
    }
    scheduleDailyPinballReport();
  }, delay);
}

// Weather code decoder helper function (WMO Weather interpretation codes)
function decodeWeatherCode(code) {
  switch (code) {
    case 0: return '☀️ Trời quang đãng';
    case 1: return '🌤️ Ít mây';
    case 2: return '⛅ Mây rải rác';
    case 3: return '☁️ Nhiều mây / U ám';
    case 45: return '🌫️ Sương mù';
    case 48: return '🌫️ Sương muối / Sương băng';
    case 51: return '🌧️ Mưa phùn nhẹ';
    case 53: return '🌧️ Mưa phùn vừa';
    case 55: return '🌧️ Mưa phùn dày đặc';
    case 56: return '🌨️ Mưa phùn lạnh nhẹ';
    case 57: return '🌨️ Mưa phùn lạnh dày';
    case 61: return '🌧️ Mưa rào nhẹ';
    case 63: return '🌧️ Mưa rào vừa';
    case 65: return '🌧️ Mưa rào nặng hạt';
    case 66: return '🌨️ Mưa rào lạnh nhẹ';
    case 67: return '🌨️ Mưa rào lạnh nặng';
    case 71: return '❄️ Tuyết rơi nhẹ';
    case 73: return '❄️ Tuyết rơi vừa';
    case 75: return '❄️ Tuyết rơi dày';
    case 77: return '❄️ Hạt tuyết';
    case 80: return '🌧️ Mưa phùn ngắt quãng';
    case 81: return '🌧️ Mưa rào vừa';
    case 82: return '🌧️ Mưa rào rất to';
    case 85: return '❄️ Tuyết rơi ngắt quãng nhẹ';
    case 86: return '❄️ Tuyết rơi ngắt quãng nặng';
    case 95: return '⛈️ Dông bão';
    case 96: return '⛈️ Dông kèm mưa đá nhẹ';
    case 99: return '⛈️ Dông kèm mưa đá rất to';
    default: return '❓ Chưa rõ trạng thái';
  }
}

// Command: /weather [hours] or /w [hours]
async function handleWeather(ctx) {
  try {
    const text = String(ctx.message?.text || '').trim();
    const args = text.split(/\s+/);
    let hours = 6;
    if (args.length > 1) {
      const parsed = parseInt(args[1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        hours = parsed;
      }
    }

    const url = 'https://api.open-meteo.com/v1/forecast?latitude=21.0285&longitude=105.8542&hourly=temperature_2m,precipitation_probability,weathercode&timezone=Asia%2FBangkok';
    const response = await axios.get(url, { timeout: 10000 });
    const hourly = response.data.hourly;

    if (!hourly || !hourly.time) {
      throw new Error('Cấu trúc dữ liệu API thời tiết không hợp lệ.');
    }

    // Get current hour local to Asia/Bangkok (Hanoi)
    const localISO = new Date().toLocaleString('sv', { timeZone: 'Asia/Bangkok' }).replace(' ', 'T');
    const currentHourStr = localISO.substring(0, 13) + ':00'; // e.g. "2026-07-09T17:00"

    // Find the index matching or directly after current server hour
    let startIndex = hourly.time.findIndex(t => t >= currentHourStr);
    if (startIndex === -1) {
      startIndex = 0;
    }

    let message = `🌤️ *Dự báo thời tiết Hà Nội (${hours} giờ tới)*\n\n`;
    const endIndex = Math.min(startIndex + hours, hourly.time.length);

    for (let i = startIndex; i < endIndex; i++) {
      const timeStr = hourly.time[i];
      const timePart = timeStr.split('T')[1]; // Extracts "HH:MM"
      const temp = hourly.temperature_2m[i];
      const rainProb = hourly.precipitation_probability[i];
      const code = hourly.weathercode[i];
      const status = decodeWeatherCode(code);

      message += `🕒 *${timePart}* | 🌡️ *${temp}°C* | 💧 *Mưa: ${rainProb}%* | ${status}\n`;
    }

    await ctx.replyWithMarkdown(message);
  } catch (error) {
    console.error('Weather command error:', error.message);
    await ctx.reply(`❌ Lỗi khi lấy dữ liệu thời tiết: ${error.message}`);
  }
}

bot.command('weather', handleWeather);
bot.command('w', handleWeather);

// Command: /g <url/domain> or /g link <url/domain>
function getCommandArgument(ctx) {
  const text = String(ctx.message?.text || '').trim();
  const firstSpaceIndex = text.indexOf(' ');
  return firstSpaceIndex === -1 ? '' : text.slice(firstSpaceIndex + 1).trim();
}

function normalizeTargetUrl(input) {
  let target = String(input || '').trim();
  if (!target) return null;

  // Loại bỏ các từ khóa dư thừa nếu người dùng gõ /g link google.com, /g url google.com, v.v.
  target = target.replace(/^(?:link|url|getlink|site|web|scan)\s+/i, '').trim();

  // Nếu người dùng chỉ gõ /g link hoặc /g url mà không truyền tên miền
  if (['link', 'url', 'getlink', 'site', 'web', 'scan'].includes(target.toLowerCase())) {
    return null;
  }

  target = target.replace(/\s+/g, '');
  if (!target) return null;
  if (!/^https?:\/\//i.test(target)) target = 'https://' + target;

  const parsed = new URL(target);
  parsed.hash = '';
  if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') {
    parsed.hostname += '.com';
  }
  return parsed;
}

function cleanText(value, fallback = 'Liên kết') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function deduplicateLinks(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.url.toLowerCase().replace(/\/$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function describeNetworkError(error) {
  const code = error?.code || error?.cause?.code;
  if (code === 'ENOTFOUND') return 'Không tìm thấy tên miền. Hãy kiểm tra lại, ví dụ: google.com.';
  if (code === 'EAI_AGAIN') return 'DNS đang phản hồi chậm. Hãy thử lại sau ít phút.';
  if (code === 'ECONNREFUSED') return 'Máy chủ từ chối kết nối.';
  if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') return 'Trang phản hồi quá lâu và đã hết thời gian chờ.';
  if (error?.response?.status) return 'Trang trả về HTTP ' + error.response.status + '.';
  return error?.message || 'Không thể truy cập trang.';
}

async function fetchWebsite(url) {
  const config = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8'
    },
    timeout: 15000,
    maxRedirects: 8,
    responseType: 'text',
    validateStatus: (status) => status >= 200 && status < 400,
    httpsAgent: new https.Agent({ rejectUnauthorized: false })
  };

  try {
    return await axios.get(url.href, config);
  } catch (error) {
    if (url.protocol === 'https:') {
      const httpUrl = new URL(url.href);
      httpUrl.protocol = 'http:';
      try {
        return await axios.get(httpUrl.href, config);
      } catch (_) {
        // Trả lỗi HTTPS ban đầu vì thường có thông tin chính xác hơn.
      }
    }
    throw error;
  }
}

const GETLINK_INPUT_PROMPT = '🌐 Nhập tên miền hoặc URL cần quét:';

async function runGetLink(ctx, target) {
  let targetUrl;
  try {
    targetUrl = normalizeTargetUrl(target);
  } catch (_) {
    targetUrl = null;
  }

  if (!targetUrl) {
    return ctx.reply('⚠️ Tên miền hoặc URL không hợp lệ. Ví dụ: /g google.com hoặc /g link google.com');
  }

  const statusMsg = await ctx.reply('🔎 Đang quét liên kết từ: ' + targetUrl.href);

  try {
    const response = await fetchWebsite(targetUrl);
    let finalUrl = targetUrl;
    try {
      const respUrl = response.request?.res?.responseUrl;
      if (respUrl && typeof respUrl === 'string') {
        finalUrl = new URL(respUrl, targetUrl.href);
      }
    } catch (_) {
      finalUrl = targetUrl;
    }

    const hostname = finalUrl.hostname.toLowerCase().replace(/^www\./, '');
    const brandName = hostname.split('.')[0];
    const $ = cheerio.load(response.data);
    const mirrors = [];
    const external = [];
    const internal = [];

    const classify = (title, rawUrl) => {
      try {
        const absolute = new URL(rawUrl, finalUrl.href);
        if (!['http:', 'https:'].includes(absolute.protocol)) return;
        absolute.hash = '';
        const linkHost = absolute.hostname.toLowerCase().replace(/^www\./, '');
        const item = { title: cleanText(title, linkHost), url: absolute.href };

        if (linkHost === hostname) internal.push(item);
        else if (linkHost.includes(brandName)) mirrors.push(item);
        else external.push(item);
      } catch (_) {
        // Bỏ qua URL lỗi.
      }
    };

    $('a[href]').each((_, element) => {
      classify($(element).text(), $(element).attr('href'));
    });

    const searchableText = $('script').map((_, element) => $(element).html()).get().join('\n');
    const domainRegex = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,24}(?:\/[a-z0-9._~:/?#\[\]@!$&'()*+,;=%-]*)?/gi;
    const discovered = searchableText.match(domainRegex) || [];
    discovered.slice(0, 100).forEach((value) => {
      const url = /^https?:\/\//i.test(value) ? value : 'https://' + value;
      classify('Tên miền được phát hiện', url);
    });

    const uniqueMirrors = deduplicateLinks(mirrors).slice(0, 8);
    const uniqueExternal = deduplicateLinks(external).slice(0, 8);
    const uniqueInternal = deduplicateLinks(internal).slice(0, 6);
    await ctx.deleteMessage(statusMsg.message_id).catch(() => {});

    if (!uniqueMirrors.length && !uniqueExternal.length && !uniqueInternal.length) {
      return ctx.reply('⚠️ Trang mở được nhưng không tìm thấy liên kết công khai trong HTML. Trang có thể tải nội dung bằng JavaScript.');
    }

    const lines = ['🔗 <b>Kết quả quét:</b> ' + escapeHtml(finalUrl.href), ''];
    const appendGroup = (heading, items) => {
      if (!items.length) return;
      lines.push('<b>' + heading + '</b>');
      items.forEach((item) => {
        lines.push('• <a href="' + escapeHtml(item.url) + '">' + escapeHtml(item.title) + '</a>');
      });
      lines.push('');
    };

    appendGroup('🌐 Tên miền/cổng liên quan', uniqueMirrors);
    appendGroup('📢 Liên kết ngoài', uniqueExternal);
    if (!uniqueMirrors.length && !uniqueExternal.length) appendGroup('🏠 Liên kết trong trang', uniqueInternal);
    else if (uniqueInternal.length) lines.push('🏠 Có thêm ' + uniqueInternal.length + ' liên kết nội bộ.');

    return ctx.reply(lines.join('\n').slice(0, 4000), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true }
    });
  } catch (error) {
    await ctx.deleteMessage(statusMsg.message_id).catch(() => {});
    console.error('Getlink error:', error);
    return ctx.reply('❌ Không quét được trang: ' + describeNetworkError(error));
  }
}

async function handleGetLink(ctx) {
  const rawTarget = getCommandArgument(ctx);
  let targetUrl = null;
  if (rawTarget) {
    try {
      targetUrl = normalizeTargetUrl(rawTarget);
    } catch (_) {
      targetUrl = null;
    }
  }

  if (targetUrl) return runGetLink(ctx, rawTarget);

  return ctx.reply(GETLINK_INPUT_PROMPT, {
    reply_markup: {
      force_reply: true,
      selective: true,
      input_field_placeholder: 'Ví dụ: google.com hoặc link google.com'
    }
  });
}

bot.command('g', handleGetLink);
bot.command('getlink', handleGetLink);

// Command: /s <query>
function decodeDuckDuckGoUrl(href) {
  try {
    const parsed = new URL(href, 'https://duckduckgo.com');
    const redirect = parsed.searchParams.get('uddg');
    return redirect ? decodeURIComponent(redirect) : parsed.href;
  } catch (_) {
    return href;
  }
}

function formatSearchResults(query, results, sourceName) {
  const lines = ['🔎 <b>Kết quả cho:</b> ' + escapeHtml(query), ''];
  results.slice(0, 5).forEach((item, index) => {
    lines.push('<b>' + (index + 1) + '.</b> <a href="' + escapeHtml(item.url) + '">' + escapeHtml(item.title) + '</a>');
    if (item.snippet) lines.push(escapeHtml(item.snippet));
    lines.push('');
  });
  lines.push('<i>Nguồn: ' + escapeHtml(sourceName) + '</i>');
  return lines.join('\n').slice(0, 4000);
}

async function searchGoogleCustom(query) {
  if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) return [];
  const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
    params: { q: query, key: GOOGLE_API_KEY, cx: GOOGLE_CSE_ID, num: 5 },
    timeout: 10000
  });
  return (response.data?.items || []).map((item) => ({
    title: cleanText(item.title, item.link),
    url: item.link,
    snippet: cleanText(item.snippet, '')
  }));
}

async function searchDuckDuckGo(query) {
  const response = await axios.get('https://html.duckduckgo.com/html/', {
    params: { q: query, kl: 'vn-vi' },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8'
    },
    timeout: 15000,
    responseType: 'text'
  });

  const $ = cheerio.load(response.data);
  const results = [];
  $('.result, .results_links').each((_, element) => {
    const link = $(element).find('.result__a, .result-link').first();
    const href = link.attr('href');
    if (!href) return;
    const snippet = $(element).find('.result__snippet, .result-snippet').first().text();
    results.push({
      title: cleanText(link.text(), href),
      url: decodeDuckDuckGoUrl(href),
      snippet: cleanText(snippet, '')
    });
  });
  return deduplicateLinks(results).slice(0, 5);
}

async function searchWikipedia(query, language) {
  const response = await axios.get('https://' + language + '.wikipedia.org/w/api.php', {
    params: { action: 'query', list: 'search', srsearch: query, utf8: 1, format: 'json', srlimit: 5 },
    headers: { 'User-Agent': 'PinballTelegramBot/1.0' },
    timeout: 10000
  });

  return (response.data?.query?.search || []).map((item) => ({
    title: item.title,
    url: 'https://' + language + '.wikipedia.org/wiki/' + encodeURIComponent(item.title.replace(/ /g, '_')),
    snippet: cleanText(String(item.snippet || '').replace(/<\/?[^>]+>/g, ''), '')
  }));
}

const SEARCH_INPUT_PROMPT = '🔎 Nhập từ khóa cần tìm:';

async function runSearch(ctx, query) {
  const statusMsg = await ctx.reply('🔎 Đang tìm kiếm: ' + query);
  try {
    let results = [];
    let sourceName = '';

    try {
      results = await searchGoogleCustom(query);
      if (results.length) sourceName = 'Google Custom Search';
    } catch (error) {
      console.warn('Google Custom Search failed:', error.message);
    }

    if (!results.length) {
      try {
        results = await searchDuckDuckGo(query);
        if (results.length) sourceName = 'DuckDuckGo';
      } catch (error) {
        console.warn('DuckDuckGo HTML search failed:', error.message);
      }
    }

    if (!results.length) {
      try {
        results = await searchWikipedia(query, 'vi');
        if (!results.length) results = await searchWikipedia(query, 'en');
        if (results.length) sourceName = 'Wikipedia';
      } catch (error) {
        console.warn('Wikipedia search failed:', error.message);
      }
    }

    await ctx.deleteMessage(statusMsg.message_id).catch(() => {});
    if (!results.length) return ctx.reply('⚠️ Không tìm thấy kết quả. Hãy thử từ khóa cụ thể hơn.');

    return ctx.reply(formatSearchResults(query, results, sourceName), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true }
    });
  } catch (error) {
    await ctx.deleteMessage(statusMsg.message_id).catch(() => {});
    console.error('Search command error:', error);
    return ctx.reply('❌ Tìm kiếm thất bại: ' + describeNetworkError(error));
  }
}

async function handleSearch(ctx) {
  const query = getCommandArgument(ctx);
  if (query) return runSearch(ctx, query);

  return ctx.reply(SEARCH_INPUT_PROMPT, {
    reply_markup: {
      force_reply: true,
      selective: true,
      input_field_placeholder: 'Nhập nội dung cần tìm kiếm'
    }
  });
}

bot.command('s', handleSearch);
bot.command('search', handleSearch);

const CHECK_INPUT_PROMPT = '🔍 Nhập tên hoặc SĐT khách hàng (từ 3 ký tự):';

async function runCheck(ctx, query) {
  if (!isAuthorizedPinballAdmin(ctx)) {
    return ctx.reply('⚠️ Bạn không có quyền sử dụng chức năng này.');
  }

  const q = String(query || '').trim();
  if (q.length < 3) {
    return ctx.reply('⚠️ Vui lòng nhập từ khóa tìm kiếm từ 3 ký tự trở lên (tên hoặc SĐT).');
  }

  const statusMsg = await ctx.reply('🔍 Đang tra cứu thông tin khách hàng: ' + q + '...');

  try {
    const endpoint = new URL('/api/deposits/lookup', getPinballAppUrl());
    endpoint.searchParams.set('q', q);

    const response = await axios.get(endpoint.href, { timeout: 15000 });
    const suggestions = Array.isArray(response.data?.suggestions) ? response.data.suggestions : [];

    await ctx.deleteMessage(statusMsg.message_id).catch(() => {});

    if (suggestions.length === 0) {
      return ctx.reply('❌ Không tìm thấy khách hàng nào khớp với từ khóa "<code>' + escapeHtml(q) + '</code>".', { parse_mode: 'HTML' });
    }

    const lines = [
      '🔍 <b>Kết quả tra cứu khách hàng:</b>',
      ''
    ];

    suggestions.forEach((item) => {
      const statusEmoji = item.activeDeposits > 0 ? '🟢' : '⚪';
      lines.push(statusEmoji + ' <b>' + escapeHtml(item.fullName) + '</b>');
      lines.push('📱 SĐT: <code>' + escapeHtml(item.phone) + '</code>');
      lines.push('💳 Đang giữ: <b>' + item.totalCards + '</b> thẻ | 🟡 <b>' + item.totalBalls + '</b> bi');
      lines.push('');
    });

    return ctx.reply(lines.join('\n').slice(0, 4000), { parse_mode: 'HTML' });
  } catch (error) {
    await ctx.deleteMessage(statusMsg.message_id).catch(() => {});
    console.error('Check command error:', error);
    return ctx.reply('❌ Tra cứu thất bại: ' + (error?.response?.data?.message || error?.message || 'Lỗi kết nối.'));
  }
}

async function handleCheck(ctx) {
  if (!isAuthorizedPinballAdmin(ctx)) {
    return ctx.reply('⚠️ Bạn không có quyền sử dụng chức năng này.');
  }

  const query = getCommandArgument(ctx);
  if (query) return runCheck(ctx, query);

  return ctx.reply(CHECK_INPUT_PROMPT, {
    reply_markup: {
      force_reply: true,
      selective: true,
      input_field_placeholder: 'Tên hoặc số điện thoại'
    }
  });
}

bot.command('c', handleCheck);
bot.command('check', handleCheck);

function isValidPinballReportDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + 'T00:00:00+07:00');
  return !Number.isNaN(parsed.getTime()) && getPinballReportDateParts(parsed).date === date;
}

function getRequestedPinballReportDate(argument, now = new Date()) {
  const normalizedArgument = String(argument || '').trim().toLowerCase();
  const today = getPinballReportDateParts(now).date;

  if (!normalizedArgument) return getMostRecentlyCompletedPinballReportDate(now);
  if (['hom nay', 'hôm nay', 'today'].includes(normalizedArgument)) return today;
  if (['hom qua', 'hôm qua', 'yesterday'].includes(normalizedArgument)) {
    return getPreviousPinballReportDate(today);
  }

  const vietnameseDate = normalizedArgument.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const date = vietnameseDate
    ? vietnameseDate[3] + '-' + vietnameseDate[2].padStart(2, '0') + '-' + vietnameseDate[1].padStart(2, '0')
    : normalizedArgument;

  return isValidPinballReportDate(date) ? date : null;
}

bot.command('baocao', async (ctx) => {
  if (!isAuthorizedPinballAdmin(ctx)) {
    return ctx.reply('⚠️ Bạn không có quyền xem báo cáo Pinball.');
  }

  const reportDate = getRequestedPinballReportDate(getCommandArgument(ctx));
  if (!reportDate) {
    return ctx.reply([
      '⚠️ Ngày báo cáo chưa đúng.',
      'Dùng: <code>/baocao</code>, <code>/baocao hôm nay</code>, <code>/baocao hôm qua</code> hoặc <code>/baocao 04/08/2026</code>.'
    ].join('\n'), { parse_mode: 'HTML' });
  }

  try {
    const report = await fetchDailyPinballReport(reportDate);
    for (const message of formatDailyPinballReports(report)) {
      await ctx.reply(message, { parse_mode: 'HTML' });
    }
  } catch (error) {
    console.error('Manual Pinball report failed:', error);
    return ctx.reply('❌ Không lấy được báo cáo: ' + describePinballApiError(error));
  }
});

bot.on('text', async (ctx, next) => {
  const replyText = String(ctx.message?.reply_to_message?.text || '').trim();
  const inputText = String(ctx.message?.text || '').trim();

  if (replyText === CHECK_INPUT_PROMPT) {
    if (!inputText || inputText.startsWith('/')) {
      return ctx.reply('⚠️ Hãy nhập tên hoặc số điện thoại khách hàng.');
    }
    return runCheck(ctx, inputText);
  }

  if (replyText === GETLINK_INPUT_PROMPT) {
    if (!inputText || inputText.startsWith('/')) {
      return ctx.reply('⚠️ Hãy nhập tên miền hoặc URL, ví dụ: google.com');
    }
    return runGetLink(ctx, inputText);
  }

  if (replyText === SEARCH_INPUT_PROMPT) {
    if (!inputText || inputText.startsWith('/')) {
      return ctx.reply('⚠️ Hãy nhập từ khóa cần tìm.');
    }
    return runSearch(ctx, inputText);
  }

  return next();
});

// Bot command menu
const BOT_COMMANDS = [
  { command: 'c', description: 'Tra cứu thẻ & bi: /c tên/SĐT' },
  { command: 'baocao', description: 'Xem báo cáo ngày đã chốt hoặc chọn ngày' },
  { command: 'g', description: 'Quét liên kết: /g tenmien.com hoặc /g link tenmien.com' },
  { command: 's', description: 'Tìm kiếm web: /s từ khóa' },
  { command: 'w', description: 'Dự báo thời tiết Hà Nội: /w [số giờ]' },
  { command: 'weather', description: 'Dự báo thời tiết Hà Nội: /weather [số giờ]' },
  { command: 'id', description: 'Xem Telegram Chat ID của bạn' },
  { command: 'help', description: 'Xem hướng dẫn sử dụng bot' }
];

const helpText = [
  '🤖 <b>Menu chức năng</b>',
  '',
  '• <b>/c tên/SĐT</b> — tra cứu số dư thẻ & bi của khách',
  '• <b>/baocao</b> — xem báo cáo ngày đã chốt gần nhất',
  '  Dùng <code>/baocao hôm nay</code>, <code>/baocao hôm qua</code> hoặc <code>/baocao 04/08/2026</code> để chọn ngày',
  '• <b>/g tenmien.com</b> — quét link & tên miền (VD: <code>/g google.com</code> hoặc <code>/g link google.com</code>)',
  '• <b>/s từ khóa</b> — tìm kiếm web',
  '• <b>/w [số giờ]</b> hoặc <b>/weather [số giờ]</b> — xem thời tiết Hà Nội (mặc định 6 giờ tới, VD: <code>/w 12</code>)',
  '• <b>/id</b> — xem ID để thêm vào danh sách nhận thông báo',
  '',
  'Bạn cũng có thể bấm nút <b>Menu</b> cạnh ô nhập tin nhắn.'
].join('\n');

bot.start((ctx) => ctx.reply(helpText, { parse_mode: 'HTML' }));
bot.help((ctx) => ctx.reply(helpText, { parse_mode: 'HTML' }));

Promise.all([
  bot.telegram.setMyCommands(BOT_COMMANDS),
  bot.telegram.callApi('setChatMenuButton', { menu_button: { type: 'commands' } })
]).then(() => {
  console.log('Telegram command menu configured');
}).catch((error) => {
  console.warn('Failed to configure Telegram command menu:', error.message);
});

bot.command('id', async (ctx) => {
  const chatId = String(ctx.chat?.id || 'Không xác định');
  const userId = String(ctx.from?.id || 'Không xác định');
  const isConfigured = ADMIN_CHAT_IDS.includes(chatId);
  const status = isConfigured
    ? '✅ Chat này đang nhận thông báo Pinball.'
    : '⚠️ Chat này chưa có trong ADMIN_CHAT_IDS.';

  return ctx.reply([
    '🆔 <b>Telegram Chat ID</b>',
    '',
    '<code>' + escapeHtml(chatId) + '</code>',
    '',
    'User ID: <code>' + escapeHtml(userId) + '</code>',
    status,
    '',
    'Thêm vào ENV Dokploy theo mẫu:',
    '<code>ADMIN_CHAT_IDS=' + escapeHtml(chatId) + '</code>',
    '',
    'Nhiều tài khoản: ngăn cách các ID bằng dấu phẩy.'
  ].join('\n'), { parse_mode: 'HTML' });
});

// Pinball record action callbacks
bot.action(/^pb:del:([0-9a-f]{24})$/i, async (ctx) => {
  const recordId = ctx.match[1];
  if (!isAuthorizedPinballAdmin(ctx)) {
    return ctx.answerCbQuery('Bạn không có quyền thao tác.', { show_alert: true });
  }

  await ctx.answerCbQuery();
  return ctx.editMessageReplyMarkup(buildPinballDeleteConfirmKeyboard(recordId));
});

bot.action(/^pb:no:([0-9a-f]{24})$/i, async (ctx) => {
  const recordId = ctx.match[1];
  if (!isAuthorizedPinballAdmin(ctx)) {
    return ctx.answerCbQuery('Bạn không có quyền thao tác.', { show_alert: true });
  }

  await ctx.answerCbQuery('Đã huỷ');
  return ctx.editMessageReplyMarkup(buildPinballActionKeyboard(recordId).reply_markup);
});

bot.action(/^pb:yes:([0-9a-f]{24})$/i, async (ctx) => {
  const recordId = ctx.match[1];
  if (!isAuthorizedPinballAdmin(ctx)) {
    return ctx.answerCbQuery('Bạn không có quyền thao tác.', { show_alert: true });
  }

  await ctx.answerCbQuery('Đang xoá bản ghi...');

  try {
    const response = await deletePinballRecord(recordId);
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    const customerName = response.data?.fullName ? ' của ' + response.data.fullName : '';
    const restoredParts = [];
    if (response.data?.restoredCards > 0) restoredParts.push(response.data.restoredCards + ' thẻ');
    if (response.data?.restoredBalls > 0) restoredParts.push(response.data.restoredBalls + ' bi');
    const restoredText = restoredParts.length ? ' Đã hoàn ' + restoredParts.join(' và ') + ' vào số đang giữ.' : '';
    return ctx.reply('✅ Đã xoá bản ghi' + customerName + '.' + restoredText);
  } catch (error) {
    console.error('Delete Pinball record failed:', error);
    return ctx.reply('❌ Không xoá được bản ghi: ' + describePinballApiError(error));
  }
});
// End Pinball record action callbacks

// Start the Express HTTP server
const server = app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
});

// Start Telegraf bot polling
bot.launch().then(() => {
  console.log('Telegraf bot launched in polling mode');
  return (async () => {
    try {
      await sendMissedDailyPinballReportIfNeeded();
    } catch (error) {
      console.error('Failed to recover missed daily Pinball report:', describePinballApiError(error));
    } finally {
      scheduleDailyPinballReport();
    }
  })();
}).catch((err) => {
  console.error('Failed to launch Telegraf bot:', err);
});

// Handle graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`${signal} received. Shutting down gracefully...`);
  if (dailyPinballReportTimer) clearTimeout(dailyPinballReportTimer);
  bot.stop(signal);
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
};

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
