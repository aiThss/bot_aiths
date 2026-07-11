import fs from 'node:fs';

const indexPath = new URL('../index.js', import.meta.url);
let source = fs.readFileSync(indexPath, 'utf8');

const helperMarker = 'function buildPinballActionKeyboard';
const routeMarker = "app.post('/webhook/pinball', async (req, res) => {";

if (!source.includes(helperMarker)) {
  const routeIndex = source.indexOf(routeMarker);
  if (routeIndex === -1) {
    throw new Error('Không tìm thấy webhook Pinball để thêm nút thao tác');
  }

  const helpers = String.raw`function getPinballAppUrl() {
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

  const appUrl = getPinballAppUrl();
  const editUrl = new URL('/admin', appUrl);
  editUrl.searchParams.set('record', recordId);
  editUrl.searchParams.set('action', 'edit');

  const deleteUrl = new URL('/admin', appUrl);
  deleteUrl.searchParams.set('record', recordId);
  deleteUrl.searchParams.set('action', 'delete');

  return {
    reply_markup: {
      inline_keyboard: [[
        { text: '✏️ Cập nhật', url: editUrl.href },
        { text: '🗑️ Xoá bản ghi', url: deleteUrl.href }
      ]]
    }
  };
}

`;

  source = source.slice(0, routeIndex) + helpers + source.slice(routeIndex);
}

const originalSend = "    await bot.telegram.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'HTML' });";
const updatedSend = "    const telegramOptions = { parse_mode: 'HTML', ...buildPinballActionKeyboard(payload.id) };\n" +
  "    await bot.telegram.sendMessage(ADMIN_CHAT_ID, message, telegramOptions);";

if (source.includes(originalSend)) {
  source = source.replace(originalSend, updatedSend);
} else if (!source.includes('...buildPinballActionKeyboard(payload.id)')) {
  throw new Error('Không tìm thấy lệnh gửi Telegram để thêm inline keyboard');
}

fs.writeFileSync(indexPath, source, 'utf8');
console.log('Đã thêm nút cập nhật và xoá bản ghi Pinball vào thông báo Telegram');
