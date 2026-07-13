import fs from 'node:fs';

const indexPath = new URL('../index.js', import.meta.url);
let source = fs.readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n');

function replaceRequired(search, replacement, errorMessage) {
  if (!source.includes(search)) {
    if (source.includes(replacement)) return;
    throw new Error(errorMessage);
  }
  source = source.replace(search, replacement);
}

// 1. Inject functions and registrations
const searchRegister = `bot.command('s', handleSearch);
bot.command('search', handleSearch);`;

const checkImplementation = `bot.command('s', handleSearch);
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

    return ctx.reply(lines.join('\\n').slice(0, 4000), { parse_mode: 'HTML' });
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
bot.command('check', handleCheck);`;

replaceRequired(
  searchRegister,
  checkImplementation,
  'Không tìm thấy đăng ký lệnh /s /search để chèn lệnh /c'
);

// 2. Inject text listener hook
const getlinkPromptCheck = `if (replyText === GETLINK_INPUT_PROMPT) {`;
const getlinkPromptCheckReplacement = `if (replyText === CHECK_INPUT_PROMPT) {
    if (!inputText || inputText.startsWith('/')) {
      return ctx.reply('⚠️ Hãy nhập tên hoặc số điện thoại khách hàng.');
    }
    return runCheck(ctx, inputText);
  }

  if (replyText === GETLINK_INPUT_PROMPT) {`;

replaceRequired(
  getlinkPromptCheck,
  getlinkPromptCheckReplacement,
  'Không tìm thấy GETLINK_INPUT_PROMPT check trong text listener'
);

// 3. Inject menu command
const getlinkMenuEntry = `{ command: 'g', description: 'Quét liên kết: /g tenmien.com' },`;
const getlinkMenuEntryReplacement = `{ command: 'c', description: 'Tra cứu thẻ & bi: /c tên/SĐT' },
  { command: 'g', description: 'Quét liên kết: /g tenmien.com' },`;

replaceRequired(
  getlinkMenuEntry,
  getlinkMenuEntryReplacement,
  'Không tìm thấy menu quét liên kết /g để chèn /c'
);

// 4. Inject help text entry
const getlinkHelpLine = `'• <b>/g tenmien.com</b> — quét link và tên miền liên quan',`;
const getlinkHelpLineReplacement = `'• <b>/c tên/SĐT</b> — tra cứu số dư thẻ & bi của khách',
  '• <b>/g tenmien.com</b> — quét link và tên miền liên quan',`;

replaceRequired(
  getlinkHelpLine,
  getlinkHelpLineReplacement,
  'Không tìm thấy dòng trợ giúp /g để chèn trợ giúp /c'
);

fs.writeFileSync(indexPath, source, 'utf8');
console.log('Đã tích hợp lệnh /c (check khách hàng) vào index.js');
