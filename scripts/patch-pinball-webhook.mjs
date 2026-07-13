import fs from 'node:fs';

const indexPath = new URL('../index.js', import.meta.url);
let source = fs.readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n');

function replaceSection(startMarkers, endMarker, replacement) {
  const markers = Array.isArray(startMarkers) ? startMarkers : [startMarkers];
  const found = markers
    .map((marker) => ({ marker, index: source.indexOf(marker) }))
    .filter((item) => item.index !== -1)
    .sort((a, b) => a.index - b.index)[0];

  if (!found) {
    throw new Error('Không tìm thấy marker: ' + markers.join(' | '));
  }

  const end = source.indexOf(endMarker, found.index);
  if (end === -1) {
    throw new Error('Không tìm thấy end marker: ' + endMarker);
  }

  source = source.slice(0, found.index) + replacement + source.slice(end);
}

const webhookReplacement = String.raw`// Webhook notification endpoint
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

    const message = [
      '🔔 <b>Thông báo mới từ Pinball!</b>',
      '',
      '• <b>Tên khách hàng:</b> ' + escapeHtml(customerName),
      '• <b>Số điện thoại:</b> ' + escapeHtml(phone),
      ...actionLines,
      '• <b>Nhân viên:</b> ' + escapeHtml(staffName) +
        ' tạo lúc ' + escapeHtml(formatDepositTime(depositTime)) +
        ' ' + escapeHtml(formatDepositDate(depositDate))
    ].join('\n');

    console.log('Received Pinball webhook for ' + phone);
    await bot.telegram.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'HTML' });
    return res.status(200).json({ success: true, message: 'Notification sent to admin' });
  } catch (error) {
    console.error('Failed to send webhook notification to admin:', error.message);
    return res.status(500).json({ error: 'Failed to send Telegram notification: ' + error.message });
  }
});

`;

const dnsReplacement = String.raw`// DNS configuration
// Dùng DNS mặc định của hệ điều hành. Custom lookup cũ không xử lý options.all,
// khiến Node nhận địa chỉ IP undefined trên một số request HTTPS.
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (_) {
  // Node cũ không hỗ trợ API này; có thể bỏ qua.
}

`;

const getLinkReplacement = String.raw`// Command: /g <url/domain>
function getCommandArgument(ctx) {
  const text = String(ctx.message?.text || '').trim();
  const firstSpaceIndex = text.indexOf(' ');
  return firstSpaceIndex === -1 ? '' : text.slice(firstSpaceIndex + 1).trim();
}

function normalizeTargetUrl(input) {
  let target = String(input || '').trim().replace(/\s+/g, '');
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
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8'
    },
    timeout: 15000,
    maxRedirects: 8,
    responseType: 'text',
    validateStatus: (status) => status >= 200 && status < 400
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

async function handleGetLink(ctx) {
  const target = getCommandArgument(ctx);
  if (!target) {
    return ctx.reply('⚠️ Cách dùng: /g tenmien.com\nVí dụ: /g google.com');
  }

  let targetUrl;
  try {
    targetUrl = normalizeTargetUrl(target);
  } catch (_) {
    return ctx.reply('⚠️ Tên miền hoặc URL không hợp lệ. Ví dụ: /g google.com');
  }

  const statusMsg = await ctx.reply('🔎 Đang quét liên kết từ: ' + targetUrl.href);

  try {
    const response = await fetchWebsite(targetUrl);
    const finalUrl = new URL(response.request?.res?.responseUrl || targetUrl.href);
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

bot.command('g', handleGetLink);
bot.command('getlink', handleGetLink);

`;

const searchReplacement = String.raw`// Command: /s <query>
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

async function handleSearch(ctx) {
  const query = getCommandArgument(ctx);
  if (!query) return ctx.reply('⚠️ Cách dùng: /s từ khóa\nVí dụ: /s thời tiết Hà Nội');

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

bot.command('s', handleSearch);
bot.command('search', handleSearch);

// Bot command menu
const BOT_COMMANDS = [
  { command: 'g', description: 'Quét liên kết: /g tenmien.com' },
  { command: 's', description: 'Tìm kiếm web: /s từ khóa' },
  { command: 'weather', description: 'Dự báo thời tiết Hà Nội' },
  { command: 'help', description: 'Xem hướng dẫn sử dụng bot' }
];

const helpText = [
  '🤖 <b>Menu chức năng</b>',
  '',
  '• <b>/g tenmien.com</b> — quét link và tên miền liên quan',
  '• <b>/s từ khóa</b> — tìm kiếm web',
  '• <b>/weather 6</b> — xem thời tiết 6 giờ tới',
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

`;

replaceSection('// Webhook notification endpoint', '// ----------------------------------------------------\n// Telegraf Bot Setup', webhookReplacement);
replaceSection(
  ['// Bypass ISP DNS blocking by using Google and Cloudflare DNS', '// DNS configuration'],
  '// Validate required environment variables',
  dnsReplacement
);
const getLinkEndMarker = ['// Command: /search <query>', '// Command: /s <query>']
  .find((marker) => source.includes(marker));
if (!getLinkEndMarker) throw new Error('Không tìm thấy marker bắt đầu phần tìm kiếm');
replaceSection(
  ['// Command: /getlink <url/domain>', '// Command: /g <url/domain>'],
  getLinkEndMarker,
  getLinkReplacement
);
replaceSection(
  ['// Command: /search <query>', '// Command: /s <query>'],
  '// Start the Express HTTP server',
  searchReplacement
);

fs.writeFileSync(indexPath, source, 'utf8');
console.log('Đã cập nhật webhook, DNS, /g, /s và menu Telegram trong index.js');
