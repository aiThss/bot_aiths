import fs from 'node:fs';

const indexPath = new URL('../index.js', import.meta.url);
let source = fs.readFileSync(indexPath, 'utf8');

function replaceRequired(search, replacement, errorMessage) {
  if (!source.includes(search)) {
    if (source.includes(replacement)) return;
    throw new Error(errorMessage);
  }
  source = source.replace(search, replacement);
}

const legacyAdminDeclaration = "const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;";
const multiAdminDeclaration = `const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const ADMIN_CHAT_IDS = [...new Set(
  [process.env.ADMIN_CHAT_ID, process.env.ADMIN_CHAT_IDS]
    .filter(Boolean)
    .join(',')
    .split(/[,;\\s]+/)
    .map((value) => value.trim())
    .filter((value) => /^-?\\d+$/.test(value))
)];`;

replaceRequired(
  legacyAdminDeclaration,
  multiAdminDeclaration,
  'Không tìm thấy khai báo ADMIN_CHAT_ID để hỗ trợ nhiều tài khoản Telegram'
);

const legacyValidation = `if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
  console.error('CRITICAL: BOT_TOKEN and ADMIN_CHAT_ID must be set in the environment.');
  process.exit(1);
}`;
const multiAdminValidation = `if (!BOT_TOKEN || ADMIN_CHAT_IDS.length === 0) {
  console.error('CRITICAL: BOT_TOKEN and at least one ADMIN_CHAT_ID or ADMIN_CHAT_IDS value must be set.');
  process.exit(1);
}`;

replaceRequired(
  legacyValidation,
  multiAdminValidation,
  'Không tìm thấy phần kiểm tra biến môi trường Telegram'
);

const legacyAuthorization = `function isAuthorizedPinballAdmin(ctx) {
  const expectedId = String(ADMIN_CHAT_ID || '').trim();
  const userId = String(ctx.from?.id || '');
  const chatId = String(ctx.chat?.id || '');
  return Boolean(expectedId && userId === expectedId && chatId === expectedId);
}`;
const multiAdminAuthorization = `function isAuthorizedPinballAdmin(ctx) {
  const userId = String(ctx.from?.id || '');
  const chatId = String(ctx.chat?.id || '');
  return Boolean(
    userId &&
    chatId &&
    ADMIN_CHAT_IDS.includes(userId) &&
    ADMIN_CHAT_IDS.includes(chatId)
  );
}`;

replaceRequired(
  legacyAuthorization,
  multiAdminAuthorization,
  'Không tìm thấy hàm phân quyền Pinball để hỗ trợ nhiều admin'
);

const legacySend = `    const telegramOptions = { parse_mode: 'HTML', ...buildPinballActionKeyboard(payload.id) };
    await bot.telegram.sendMessage(ADMIN_CHAT_ID, message, telegramOptions);`;
const multiAdminSend = `    const telegramOptions = { parse_mode: 'HTML', ...buildPinballActionKeyboard(payload.id) };
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
    }`;

replaceRequired(
  legacySend,
  multiAdminSend,
  'Không tìm thấy lệnh gửi thông báo Pinball để gửi tới nhiều tài khoản'
);

if (!source.includes("bot.command('chatid'")) {
  const commandMarker = '// Pinball record action callbacks';
  const commandIndex = source.indexOf(commandMarker);
  if (commandIndex === -1) {
    throw new Error('Không tìm thấy vị trí thêm lệnh /chatid');
  }

  const chatIdCommand = `bot.command('chatid', async (ctx) => {
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
  ].join('\\n'), { parse_mode: 'HTML' });
});

`;

  source = source.slice(0, commandIndex) + chatIdCommand + source.slice(commandIndex);
}

const helpCommandEntry = "  { command: 'help', description: 'Xem hướng dẫn sử dụng bot' }";
const chatIdCommandEntry = "  { command: 'chatid', description: 'Xem Telegram Chat ID của bạn' },\n" + helpCommandEntry;
if (!source.includes("{ command: 'chatid'")) {
  replaceRequired(
    helpCommandEntry,
    chatIdCommandEntry,
    'Không tìm thấy menu lệnh Telegram để thêm /chatid'
  );
}

const helpWeatherLine = "  '• <b>/weather 6</b> — xem thời tiết 6 giờ tới',";
const helpChatIdLine = helpWeatherLine + "\n  '• <b>/chatid</b> — xem ID để thêm vào danh sách nhận thông báo',";
if (!source.includes("<b>/chatid</b>")) {
  replaceRequired(
    helpWeatherLine,
    helpChatIdLine,
    'Không tìm thấy nội dung trợ giúp để thêm /chatid'
  );
}

fs.writeFileSync(indexPath, source, 'utf8');
console.log('Đã thêm /chatid và hỗ trợ nhiều ADMIN_CHAT_IDS');
