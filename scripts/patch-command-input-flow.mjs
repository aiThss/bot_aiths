import fs from 'node:fs';

const indexPath = new URL('../index.js', import.meta.url);
let source = fs.readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n');

if (source.includes('const GETLINK_INPUT_PROMPT')) {
  console.log('Luồng nhập liệu /g và /s đã được áp dụng');
  process.exit(0);
}

const oldGetLinkStart = `async function handleGetLink(ctx) {
  const target = getCommandArgument(ctx);
  if (!target) {
    return ctx.reply('⚠️ Cách dùng: /g tenmien.com\\nVí dụ: /g google.com');
  }

  let targetUrl;`;

const newGetLinkStart = `const GETLINK_INPUT_PROMPT = '🌐 Nhập tên miền hoặc URL cần quét:';

async function runGetLink(ctx, target) {
  let targetUrl;`;

if (!source.includes(oldGetLinkStart)) {
  throw new Error('Không tìm thấy phần mở đầu handleGetLink để cập nhật');
}
source = source.replace(oldGetLinkStart, newGetLinkStart);

const getLinkCommandMarker = `bot.command('g', handleGetLink);`;
const getLinkWrapper = `async function handleGetLink(ctx) {
  const target = getCommandArgument(ctx);
  if (target) return runGetLink(ctx, target);

  return ctx.reply(GETLINK_INPUT_PROMPT, {
    reply_markup: {
      force_reply: true,
      selective: true,
      input_field_placeholder: 'Ví dụ: google.com'
    }
  });
}

`;

if (!source.includes(getLinkCommandMarker)) {
  throw new Error('Không tìm thấy đăng ký lệnh /g');
}
source = source.replace(getLinkCommandMarker, getLinkWrapper + getLinkCommandMarker);

const oldSearchStart = `async function handleSearch(ctx) {
  const query = getCommandArgument(ctx);
  if (!query) return ctx.reply('⚠️ Cách dùng: /s từ khóa\\nVí dụ: /s thời tiết Hà Nội');

  const statusMsg = await ctx.reply('🔎 Đang tìm kiếm: ' + query);`;

const newSearchStart = `const SEARCH_INPUT_PROMPT = '🔎 Nhập từ khóa cần tìm:';

async function runSearch(ctx, query) {
  const statusMsg = await ctx.reply('🔎 Đang tìm kiếm: ' + query);`;

if (!source.includes(oldSearchStart)) {
  throw new Error('Không tìm thấy phần mở đầu handleSearch để cập nhật');
}
source = source.replace(oldSearchStart, newSearchStart);

const searchCommandMarker = `bot.command('s', handleSearch);`;
const searchWrapper = `async function handleSearch(ctx) {
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

`;

if (!source.includes(searchCommandMarker)) {
  throw new Error('Không tìm thấy đăng ký lệnh /s');
}
source = source.replace(searchCommandMarker, searchWrapper + searchCommandMarker);

const searchAliasMarker = `bot.command('search', handleSearch);`;
const replyHandler = `

bot.on('text', async (ctx, next) => {
  const replyText = String(ctx.message?.reply_to_message?.text || '').trim();
  const inputText = String(ctx.message?.text || '').trim();

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
});`;

if (!source.includes(searchAliasMarker)) {
  throw new Error('Không tìm thấy alias /search');
}
source = source.replace(searchAliasMarker, searchAliasMarker + replyHandler);

fs.writeFileSync(indexPath, source, 'utf8');
console.log('Đã thêm ForceReply cho menu /g và /s');
