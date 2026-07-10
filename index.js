const express = require('express');
const { Telegraf } = require('telegraf');
const axios = require('axios');
const cheerio = require('cheerio');
const dns = require('dns');
const http = require('http');
const https = require('https');
require('dotenv').config();

// Bypass ISP DNS blocking by using Google and Cloudflare DNS
dns.setServers(['8.8.8.8', '1.1.1.1']);

const customLookup = (hostname, options, callback) => {
  dns.resolve4(hostname, (err, addresses) => {
    if (err || !addresses || addresses.length === 0) {
      dns.lookup(hostname, options, callback);
    } else {
      callback(null, addresses[0], 4);
    }
  });
};

const httpAgent = new http.Agent({ lookup: customLookup });
const httpsAgent = new https.Agent({ lookup: customLookup });

axios.defaults.httpAgent = httpAgent;
axios.defaults.httpsAgent = httpsAgent;

// Validate required environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
  console.error('CRITICAL: BOT_TOKEN and ADMIN_CHAT_ID must be set in the environment.');
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

// Webhook notification endpoint
app.post('/webhook/pinball', async (req, res) => {
  const { id, title, type } = req.body;

  if (!id || !title || !type) {
    return res.status(400).json({ error: 'Missing required fields: id, title, type' });
  }

  try {
    console.log(`Received webhook notification for ID: ${id}`);

    const customerMatch = title.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    const detailMatch = type.match(/^(.*?)\s*\(Bởi\s+(.*?)\s+lúc\s+[^)]+\)\s*$/i);

    const customerName = customerMatch ? customerMatch[1].trim() : title.trim();
    const phone = customerMatch ? customerMatch[2].trim() : 'Không rõ';
    const rawAction = detailMatch ? detailMatch[1].trim() : type.trim();
    const staffName = detailMatch ? detailMatch[2].trim() : 'Không rõ';
    const actionLabel = /^Lấy\b/i.test(rawAction) ? 'Lấy' : 'Gửi';
    const items = rawAction
      .split(/\s*\+\s*/)
      .map((part) => part.replace(/^(Gửi|Lấy)\s+/i, '').trim())
      .filter(Boolean)
      .join(', ');

    const message = `🔔 <b>Thông báo mới từ Pinball!</b>\n\n` +
                    `• <b>Tên khách hàng:</b> ${escapeHtml(customerName)}\n` +
                    `• <b>Số điện thoại:</b> ${escapeHtml(phone)}\n` +
                    `• <b>${actionLabel}:</b> ${escapeHtml(items)}\n` +
                    `• <b>Nhân viên:</b> ${escapeHtml(staffName)}`;

    await bot.telegram.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'HTML' });

    return res.status(200).json({ success: true, message: 'Notification sent to admin' });
  } catch (error) {
    console.error('Failed to send webhook notification to admin:', error.message);
    return res.status(500).json({ error: `Failed to send Telegram notification: ${error.message}` });
  }
});

// ----------------------------------------------------
// Telegraf Bot Setup
// ----------------------------------------------------
const bot = new Telegraf(BOT_TOKEN);

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

// Command: /weather [hours]
bot.command('weather', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ');
    let hours = 6;
    if (args.length > 1) {
      const parsed = parseInt(args[1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        hours = parsed;
      }
    }

    const url = 'https://api.open-meteo.com/v1/forecast?latitude=21.0285&longitude=105.8542&hourly=temperature_2m,precipitation_probability,weathercode&timezone=Asia%2FBangkok';
    const response = await axios.get(url);
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
});

// Command: /getlink <url/domain>
bot.command('getlink', async (ctx) => {
  try {
    const text = ctx.message.text.trim();
    const firstSpaceIndex = text.indexOf(' ');
    if (firstSpaceIndex === -1) {
      return ctx.reply('⚠️ Vui lòng nhập tên miền hoặc liên kết. Ví dụ: /getlink hentaiz.to');
    }

    let target = text.substring(firstSpaceIndex).trim();
    if (!target) {
      return ctx.reply('⚠️ Vui lòng nhập tên miền hoặc liên kết. Ví dụ: /getlink hentaiz.to');
    }

    // Standardize URL
    let targetUrl = target;
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      targetUrl = 'https://' + target;
    }

    let hostname = '';
    try {
      hostname = new URL(targetUrl).hostname;
    } catch (_) {
      hostname = targetUrl.replace(/https?:\/\//, '').split('/')[0];
    }
    // brand name is the domain without TLD (e.g. sextop1.am -> sextop1)
    const brandName = hostname.split('.')[0].toLowerCase();

    const statusMsg = await ctx.reply(`🔍 Đang quét liên kết từ: ${targetUrl}...`);

    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8'
      },
      timeout: 10000
    });

    const html = response.data;
    const $ = cheerio.load(html);

    const mirrors = [];
    const external = [];
    const internal = [];

    // 1. Scrape standard <a> tags
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      const linkText = $(el).text().trim();
      if (href && href !== '#' && href !== 'javascript:void(0)' && !href.startsWith('javascript:')) {
        let absoluteUrl = href;
        if (!href.startsWith('http://') && !href.startsWith('https://')) {
          try {
            absoluteUrl = new URL(href, targetUrl).href;
          } catch (_) {}
        }

        try {
          const parsedUrl = new URL(absoluteUrl);
          const linkHost = parsedUrl.hostname.toLowerCase();

          if (linkHost === hostname.toLowerCase()) {
            internal.push({ title: linkText || 'Trang trong', url: absoluteUrl });
          } else if (linkHost.includes(brandName)) {
            mirrors.push({ title: linkText || `Tên miền phụ (${linkHost})`, url: absoluteUrl });
          } else {
            external.push({ title: linkText || `Liên kết ngoài (${linkHost})`, url: absoluteUrl });
          }
        } catch (_) {
          if (absoluteUrl.includes('t.me') || absoluteUrl.includes('telegram')) {
            external.push({ title: linkText || 'Kênh Telegram', url: absoluteUrl });
          }
        }
      }
    });

    // 2. Search for domains in scripts (bypass dynamic mirror lists like hentaiz.to)
    const scripts = $('script').map((i, el) => $(el).html()).get().join('\n');
    const hostRegex = /host:\s*['"]([^'"]+)['"]/g;
    let match;
    const foundHosts = new Set();
    while ((match = hostRegex.exec(scripts)) !== null) {
      foundHosts.add(match[1]);
    }

    const domainRegex = /[a-zA-Z0-9-]+\.(com|net|org|xyz|bike|info|club|cc|me|top|vip|us|live|tv|tokyo|am)/g;
    while ((match = domainRegex.exec(scripts)) !== null) {
      foundHosts.add(match[0]);
    }

    foundHosts.forEach(host => {
      const cleanHost = host.toLowerCase().trim();
      const isExcluded = cleanHost.includes('google') ||
                         cleanHost.includes('facebook') ||
                         cleanHost.includes('navigator') ||
                         cleanHost.includes('sw.js') ||
                         hostname.toLowerCase().includes(cleanHost);

      if (!isExcluded) {
        if (cleanHost.includes(brandName)) {
          mirrors.push({ title: `Cổng dự phòng (${cleanHost})`, url: `https://${cleanHost}` });
        } else {
          external.push({ title: `Liên kết ngoài (${cleanHost})`, url: `https://${cleanHost}` });
        }
      }
    });

    // Deduplicate helper
    const deduplicate = (arr) => {
      const seen = new Set();
      return arr.filter(item => {
        const key = item.url.toLowerCase().replace(/\/$/, '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    const uniqueMirrors = deduplicate(mirrors);
    const uniqueExternal = deduplicate(external);
    const uniqueInternal = deduplicate(internal);

    await ctx.deleteMessage(statusMsg.message_id).catch(() => {});

    if (uniqueMirrors.length === 0 && uniqueExternal.length === 0 && uniqueInternal.length === 0) {
      return ctx.reply(`⚠️ Không tìm thấy bất kỳ liên kết nào trên trang web ${targetUrl}`);
    }

    let message = `🔗 *Kết quả quét từ:* \`${targetUrl}\`\n\n`;

    // 1. Show Mirrors (High priority)
    if (uniqueMirrors.length > 0) {
      message += `🌐 *Cổng truy cập dự phòng / Tên miền khác:* \n`;
      uniqueMirrors.forEach((item, index) => {
        message += `${index + 1}. *[${item.title}](${item.url})*\n   └─ \`${item.url}\`\n`;
      });
      message += `\n`;
    }

    // 2. Show External/Social links (Telegram/Discord etc.)
    if (uniqueExternal.length > 0) {
      message += `📢 *Mạng xã hội & Liên kết ngoài liên quan:* \n`;
      uniqueExternal.forEach((item, index) => {
        message += `• *[${item.title}](${item.url})*\n  └─ \`${item.url}\`\n`;
      });
      message += `\n`;
    }

    // 3. Show internal links only if no mirrors/externals found or show maximum of 3 as preview
    if (uniqueMirrors.length === 0 && uniqueExternal.length === 0) {
      if (uniqueInternal.length > 0) {
        message += `🏠 *Các liên kết trong trang:* \n`;
        uniqueInternal.slice(0, 10).forEach((item, index) => {
          message += `• *[${item.title}](${item.url})*\n`;
        });
        if (uniqueInternal.length > 10) {
          message += `_...và ${uniqueInternal.length - 10} liên kết khác._\n`;
        }
      }
    } else if (uniqueInternal.length > 0) {
      // Show summary of internal links
      message += `🏠 _Tìm thấy ${uniqueInternal.length} liên kết chuyên mục/phim trong trang._\n`;
    }

    await ctx.replyWithMarkdown(message);
  } catch (error) {
    console.error('Scraping command error:', error.message);
    await ctx.reply(`❌ Lỗi khi quét trang web: ${error.message}\n(Tên miền có thể đang bị chặn hoặc ngoại tuyến)`);
  }
});

// Command: /search <query>
bot.command('search', async (ctx) => {
  try {
    const text = ctx.message.text.trim();
    // Support parsing query robustly (e.g. /search@bot_name query or /search query)
    const firstSpaceIndex = text.indexOf(' ');
    if (firstSpaceIndex === -1) {
      return ctx.reply('⚠️ Vui lòng nhập từ khóa tìm kiếm. Ví dụ: /search Hà Nội');
    }
    const query = text.substring(firstSpaceIndex).trim();

    if (!query) {
      return ctx.reply('⚠️ Vui lòng nhập từ khóa tìm kiếm. Ví dụ: /search Hà Nội');
    }

    // Inform user search is in progress
    const statusMsg = await ctx.reply('🔍 Đang tìm kiếm...');

    // ----------------------------------------------------
    // Method 1: Google Custom Search API (If Keys provided)
    // ----------------------------------------------------
    if (GOOGLE_API_KEY && GOOGLE_CSE_ID) {
      try {
        console.log(`Searching Google for query: "${query}"`);
        const googleUrl = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${GOOGLE_API_KEY}&cx=${GOOGLE_CSE_ID}&num=3`;
        const googleRes = await axios.get(googleUrl, { timeout: 5000 });

        if (googleRes.data && googleRes.data.items && googleRes.data.items.length > 0) {
          let message = `🔍 *Kết quả tìm kiếm Google cho:* \`${query}\`\n\n`;
          googleRes.data.items.forEach((item) => {
            message += `• *[${item.title}](${item.link})*\n  ${item.snippet || 'Không có mô tả.'}\n`;
          });

          await ctx.deleteMessage(statusMsg.message_id).catch(() => {});
          return await ctx.replyWithMarkdown(message);
        }
      } catch (err) {
        console.warn('Google Search API failed, falling back to Wikipedia/DDG:', err.message);
      }
    }

    // ----------------------------------------------------
    // Method 2: Fallback to Wikipedia + DuckDuckGo Instant Answer
    // ----------------------------------------------------
    let ddgAbstract = '';
    let ddgUrl = '';

    // Try DuckDuckGo Instant Answer
    try {
      const ddgRes = await axios.get(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 3000
      });
      if (ddgRes.data && ddgRes.data.AbstractText) {
        ddgAbstract = ddgRes.data.AbstractText;
        ddgUrl = ddgRes.data.AbstractURL;
      }
    } catch (err) {
      console.warn('DDG Search warning:', err.message);
    }

    // Try Wikipedia Full-Text Search (Search Vietnamese first, then English as fallback)
    let wikiResults = [];
    try {
      // 1. Query Vietnamese Wikipedia
      const wikiResVi = await axios.get(`https://vi.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Bot/1.0' },
        timeout: 5000
      });
      if (wikiResVi.data && wikiResVi.data.query && wikiResVi.data.query.search && wikiResVi.data.query.search.length > 0) {
        wikiResults = wikiResVi.data.query.search.slice(0, 3).map(item => {
          const cleanSnippet = item.snippet.replace(/<\/?[^>]+(>|$)/g, '');
          const url = `https://vi.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`;
          return {
            title: item.title,
            snippet: cleanSnippet,
            url: url
          };
        });
      } else {
        // 2. Fallback to English Wikipedia
        const wikiResEn = await axios.get(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Bot/1.0' },
          timeout: 5000
        });
        if (wikiResEn.data && wikiResEn.data.query && wikiResEn.data.query.search) {
          wikiResults = wikiResEn.data.query.search.slice(0, 3).map(item => {
            const cleanSnippet = item.snippet.replace(/<\/?[^>]+(>|$)/g, '');
            const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`;
            return {
              title: item.title,
              snippet: cleanSnippet,
              url: url
            };
          });
        }
      }
    } catch (err) {
      console.warn('Wikipedia Search warning:', err.message);
    }

    // Format fallback message
    let message = `🔍 *Kết quả tìm kiếm cho:* \`${query}\`\n\n`;
    if (ddgAbstract) {
      message += `💡 *Câu trả lời nhanh:*\n${ddgAbstract}\n🔗 [Nguồn](${ddgUrl})\n\n`;
    }

    if (wikiResults.length > 0) {
      message += `📚 *Bài viết liên quan (Wikipedia):*\n`;
      wikiResults.forEach((r) => {
        message += `• *[${r.title}](${r.url})*\n  ${r.snippet}...\n`;
      });
    } else if (!ddgAbstract) {
      message += `⚠️ Không tìm thấy kết quả tìm kiếm nào cho từ khóa này.`;
    }

    // Delete status message and reply with actual results
    try {
      await ctx.deleteMessage(statusMsg.message_id).catch(() => {});
    } catch (err) {
      // Ignore if message deletion fails
    }

    await ctx.replyWithMarkdown(message);
  } catch (error) {
    console.error('Search command error:', error.message);
    await ctx.reply(`❌ Lỗi hệ thống khi tìm kiếm: ${error.message}`);
  }
});

// Start the Express HTTP server
const server = app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
});

// Start Telegraf bot polling
bot.launch().then(() => {
  console.log('Telegraf bot launched in polling mode');
}).catch((err) => {
  console.error('Failed to launch Telegraf bot:', err);
});

// Handle graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`${signal} received. Shutting down gracefully...`);
  bot.stop(signal);
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
};

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
