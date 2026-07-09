const express = require('express');
const { Telegraf } = require('telegraf');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

// Validate required environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
  console.error('CRITICAL: BOT_TOKEN and ADMIN_CHAT_ID must be set in the environment.');
  process.exit(1);
}

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

// Webhook notification endpoint
app.post('/webhook/pinball', async (req, res) => {
  const { id, title, type } = req.body;

  if (!id || !title || !type) {
    return res.status(400).json({ error: 'Missing required fields: id, title, type' });
  }

  try {
    console.log(`Received webhook notification for ID: ${id}`);
    
    // Styled markdown notification format
    const message = `🔔 *New Record from Pinball!*\n\n` +
                    `• *ID:* ${id}\n` +
                    `• *Title:* ${title}\n` +
                    `• *Type:* ${type}`;

    await bot.telegram.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'Markdown' });
    
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
    case 0: return '☀️ Clear sky';
    case 1: return '🌤️ Mainly clear';
    case 2: return '⛅ Partly cloudy';
    case 3: return '☁️ Overcast';
    case 45: return '🌫️ Fog';
    case 48: return '🌫️ Depositing rime fog';
    case 51: return '🌧️ Light drizzle';
    case 53: return '🌧️ Moderate drizzle';
    case 55: return '🌧️ Dense drizzle';
    case 56: return '🌨️ Light freezing drizzle';
    case 57: return '🌨️ Dense freezing drizzle';
    case 61: return '🌧️ Slight rain';
    case 63: return '🌧️ Moderate rain';
    case 65: return '🌧️ Heavy rain';
    case 66: return '🌨️ Light freezing rain';
    case 67: return '🌨️ Heavy freezing rain';
    case 71: return '❄️ Slight snow fall';
    case 73: return '❄️ Moderate snow fall';
    case 75: return '❄️ Heavy snow fall';
    case 77: return '❄️ Snow grains';
    case 80: return '🌧️ Slight rain showers';
    case 81: return '🌧️ Moderate rain showers';
    case 82: return '🌧️ Violent rain showers';
    case 85: return '❄️ Slight snow showers';
    case 86: return '❄️ Heavy snow showers';
    case 95: return '⛈️ Thunderstorm';
    case 96: return '⛈️ Thunderstorm with slight hail';
    case 99: return '⛈️ Thunderstorm with heavy hail';
    default: return '❓ Unknown weather status';
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
      throw new Error('Invalid response structure from weather API.');
    }

    // Get current hour local to Asia/Bangkok (Hanoi)
    const localISO = new Date().toLocaleString('sv', { timeZone: 'Asia/Bangkok' }).replace(' ', 'T');
    const currentHourStr = localISO.substring(0, 13) + ':00'; // e.g. "2026-07-09T17:00"

    // Find the index matching or directly after current server hour
    let startIndex = hourly.time.findIndex(t => t >= currentHourStr);
    if (startIndex === -1) {
      startIndex = 0;
    }

    let message = `🌤️ *Hanoi Weather Forecast (Next ${hours} Hours)*\n\n`;
    const endIndex = Math.min(startIndex + hours, hourly.time.length);

    for (let i = startIndex; i < endIndex; i++) {
      const timeStr = hourly.time[i];
      const timePart = timeStr.split('T')[1]; // Extracts "HH:MM"
      const temp = hourly.temperature_2m[i];
      const rainProb = hourly.precipitation_probability[i];
      const code = hourly.weathercode[i];
      const status = decodeWeatherCode(code);

      message += `🕒 *${timePart}* | 🌡️ *${temp}°C* | 💧 *${rainProb}%* | ${status}\n`;
    }

    await ctx.replyWithMarkdown(message);
  } catch (error) {
    console.error('Weather command error:', error.message);
    await ctx.reply(`❌ Failed to retrieve weather data: ${error.message}`);
  }
});

// Command: /getlink
bot.command('getlink', async (ctx) => {
  try {
    // Replace with your target blocked website
    const targetUrl = 'https://example.com';

    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    
    // Replace with your target selector
    const element = $('a.latest-link');
    const href = element.attr('href');
    const linkText = element.text().trim();

    if (!href) {
      return ctx.reply('⚠️ No link found matching the selector `a.latest-link` on the target website.');
    }

    // Resolve relative URL if needed
    let absoluteUrl = href;
    if (!href.startsWith('http://') && !href.startsWith('https://')) {
      absoluteUrl = new URL(href, targetUrl).href;
    }

    const message = `🔗 *Latest Domain Link*\n\n` +
                    `• *Text:* ${linkText || 'N/A'}\n` +
                    `• *URL:* ${absoluteUrl}`;

    await ctx.replyWithMarkdown(message);
  } catch (error) {
    console.error('Scraping command error:', error.message);
    await ctx.reply(`❌ Failed to scrape the domain link: ${error.message}`);
  }
});

// Command: /search <query>
bot.command('search', async (ctx) => {
  try {
    const text = ctx.message.text.trim();
    const query = text.substring(7).trim(); // Remove "/search"

    if (!query) {
      return ctx.reply('⚠️ Please provide a query. Usage: /search <keyword>');
    }

    // Inform user search is in progress
    const statusMsg = await ctx.reply('🔍 Searching...');

    let ddgAbstract = '';
    let ddgUrl = '';
    
    // 1. Try DuckDuckGo Instant Answer
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

    // 2. Try Wikipedia Full-Text Search
    let wikiResults = [];
    try {
      const wikiRes = await axios.get(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000
      });
      if (wikiRes.data && wikiRes.data.query && wikiRes.data.query.search) {
        wikiResults = wikiRes.data.query.search.slice(0, 3).map(item => {
          const cleanSnippet = item.snippet.replace(/<\/?[^>]+(>|$)/g, '');
          const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`;
          return {
            title: item.title,
            snippet: cleanSnippet,
            url: url
          };
        });
      }
    } catch (err) {
      console.warn('Wikipedia Search warning:', err.message);
    }

    // Format message
    let message = `🔍 *Search Results for:* \`${query}\`\n\n`;
    if (ddgAbstract) {
      message += `💡 *Instant Answer:*\n${ddgAbstract}\n🔗 [Source](${ddgUrl})\n\n`;
    }

    if (wikiResults.length > 0) {
      message += `📚 *Related Articles (Wikipedia):*\n`;
      wikiResults.forEach((r) => {
        message += `• *[${r.title}](${r.url})*\n  ${r.snippet}...\n`;
      });
    } else if (!ddgAbstract) {
      message += `⚠️ No search results found for this query.`;
    }

    // Delete status message and reply with actual results
    try {
      await ctx.deleteMessage(statusMsg.message_id);
    } catch (err) {
      // Ignore if message deletion fails
    }

    await ctx.replyWithMarkdown(message);
  } catch (error) {
    console.error('Search command error:', error.message);
    await ctx.reply(`❌ Failed to perform search: ${error.message}`);
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
