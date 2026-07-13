import fs from 'node:fs';

const indexPath = new URL('../index.js', import.meta.url);
let source = fs.readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n');

const routeMarker = "app.post('/webhook/pinball', async (req, res) => {";
const helperStartMarker = 'function getPinballAppUrl() {';
const callbackStartMarker = '// Pinball record action callbacks';
const callbackEndMarker = '// End Pinball record action callbacks';

function replaceOrInsertHelpers() {
  const routeIndex = source.indexOf(routeMarker);
  if (routeIndex === -1) {
    throw new Error('Không tìm thấy webhook Pinball để thêm nút thao tác');
  }

  const helperIndex = source.indexOf(helperStartMarker);
  if (helperIndex !== -1 && helperIndex < routeIndex) {
    source = source.slice(0, helperIndex) + source.slice(routeIndex);
  }

  const currentRouteIndex = source.indexOf(routeMarker);
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
  const expectedId = String(ADMIN_CHAT_ID || '').trim();
  const userId = String(ctx.from?.id || '');
  const chatId = String(ctx.chat?.id || '');
  return Boolean(expectedId && userId === expectedId && chatId === expectedId);
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

`;

  source = source.slice(0, currentRouteIndex) + helpers + source.slice(currentRouteIndex);
}

function patchTelegramSend() {
  const originalSend = "    await bot.telegram.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'HTML' });";
  const previousSend = "    const telegramOptions = { parse_mode: 'HTML', ...buildPinballActionKeyboard(payload.id) };\n" +
    "    await bot.telegram.sendMessage(ADMIN_CHAT_ID, message, telegramOptions);";
  const updatedSend = previousSend;

  if (source.includes(originalSend)) {
    source = source.replace(originalSend, updatedSend);
    return;
  }

  if (!source.includes(previousSend)) {
    throw new Error('Không tìm thấy lệnh gửi Telegram để thêm inline keyboard');
  }
}

function patchCallbackHandlers() {
  const existingStart = source.indexOf(callbackStartMarker);
  if (existingStart !== -1) {
    const existingEnd = source.indexOf(callbackEndMarker, existingStart);
    if (existingEnd === -1) {
      throw new Error('Không tìm thấy marker kết thúc callback Pinball');
    }

    const beforeCallbacks = source.slice(0, existingStart).replace(/\n+$/, '');
    const afterCallbacks = source
      .slice(existingEnd + callbackEndMarker.length)
      .replace(/^\n+/, '');
    source = beforeCallbacks + '\n\n' + afterCallbacks;
  }

  const serverMarker = '// Start the Express HTTP server';
  const serverIndex = source.indexOf(serverMarker);
  if (serverIndex === -1) {
    throw new Error('Không tìm thấy marker khởi động Express');
  }

  const handlers = String.raw`// Pinball record action callbacks
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
    return ctx.reply('✅ Đã xoá bản ghi' + customerName + '.');
  } catch (error) {
    console.error('Delete Pinball record failed:', error);
    return ctx.reply('❌ Không xoá được bản ghi: ' + describePinballApiError(error));
  }
});
// End Pinball record action callbacks

`;

  source = source.slice(0, serverIndex) + handlers + source.slice(serverIndex);
}

replaceOrInsertHelpers();
patchTelegramSend();
patchCallbackHandlers();

const normalizedCallbackIndex = source.indexOf(callbackStartMarker);
if (normalizedCallbackIndex !== -1) {
  const beforeCallbacks = source.slice(0, normalizedCallbackIndex).replace(/\n+$/, '');
  source = beforeCallbacks + '\n\n' + source.slice(normalizedCallbackIndex);
}

fs.writeFileSync(indexPath, source, 'utf8');
console.log('Đã thêm Mini App cập nhật và callback xoá bản ghi Pinball');
