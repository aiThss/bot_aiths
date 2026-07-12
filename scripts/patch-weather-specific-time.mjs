import fs from 'node:fs';

const indexPath = new URL('../index.js', import.meta.url);
let source = fs.readFileSync(indexPath, 'utf8');

if (source.includes("const WEATHER_TIMEZONE = 'Asia/Bangkok';")) {
  console.log('Tính năng xem thời tiết theo ngày giờ đã được áp dụng');
  process.exit(0);
}

const weatherStartMarker = '// Command: /weather [hours]';
const weatherEndMarker = '// Command: /getlink <url/domain>';
const startIndex = source.indexOf(weatherStartMarker);
const endIndex = source.indexOf(weatherEndMarker);

if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
  throw new Error('Không tìm thấy khối lệnh /weather để cập nhật');
}

const newWeatherBlock = String.raw`// Command: /weather [hours] OR /weather 9h 13/7
const WEATHER_TIMEZONE = 'Asia/Bangkok';
const WEATHER_API_URL = 'https://api.open-meteo.com/v1/forecast';

function padWeatherNumber(value) {
  return String(value).padStart(2, '0');
}

function getHanoiDateTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: WEATHER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  return parts.reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
}

function getWeatherCommandArgument(ctx) {
  const text = String(ctx.message?.text || '').trim();
  const firstSpaceIndex = text.indexOf(' ');
  return firstSpaceIndex === -1 ? '' : text.substring(firstSpaceIndex + 1).trim();
}

function parseSpecificWeatherTime(input) {
  const match = input.match(/^(\d{1,2})(?:h(?:(\d{2}))?|:(\d{2}))\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/i);
  if (!match) {
    return {
      error: '⚠️ Cú pháp chưa đúng. Ví dụ: /weather 9h 13/7'
    };
  }

  const hour = Number(match[1]);
  const minute = Number(match[2] ?? match[3] ?? 0);
  const day = Number(match[4]);
  const month = Number(match[5]);
  const nowParts = getHanoiDateTimeParts();
  const year = Number(match[6] || nowParts.year);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return { error: '⚠️ Giờ không hợp lệ. Hãy nhập từ 0h đến 23h.' };
  }

  if (minute !== 0) {
    return { error: '⚠️ Dữ liệu dự báo theo từng giờ. Hãy dùng giờ tròn, ví dụ: 9h hoặc 09:00.' };
  }

  const validationDate = new Date(Date.UTC(year, month - 1, day));
  if (
    validationDate.getUTCFullYear() !== year ||
    validationDate.getUTCMonth() !== month - 1 ||
    validationDate.getUTCDate() !== day
  ) {
    return { error: '⚠️ Ngày không hợp lệ. Ví dụ đúng: /weather 9h 13/7' };
  }

  const targetKey = year + '-' + padWeatherNumber(month) + '-' + padWeatherNumber(day) +
    'T' + padWeatherNumber(hour) + ':00';
  const currentHourKey = nowParts.year + '-' + nowParts.month + '-' + nowParts.day +
    'T' + nowParts.hour + ':00';

  if (targetKey < currentHourKey) {
    return { error: '⚠️ Thời điểm này đã qua. Hãy nhập một ngày giờ trong tương lai.' };
  }

  return { targetKey, hour, day, month, year };
}

async function fetchHanoiHourlyWeather() {
  const response = await axios.get(WEATHER_API_URL, {
    params: {
      latitude: 21.0285,
      longitude: 105.8542,
      hourly: 'temperature_2m,precipitation_probability,weathercode',
      timezone: WEATHER_TIMEZONE,
      forecast_days: 16
    },
    timeout: 10000
  });

  const hourly = response.data?.hourly;
  if (!hourly?.time || !hourly?.temperature_2m || !hourly?.precipitation_probability || !hourly?.weathercode) {
    throw new Error('Cấu trúc dữ liệu API thời tiết không hợp lệ.');
  }

  return hourly;
}

function formatSpecificWeatherMessage(hourly, weatherIndex, target) {
  const temp = hourly.temperature_2m[weatherIndex];
  const rainProb = hourly.precipitation_probability[weatherIndex];
  const status = decodeWeatherCode(hourly.weathercode[weatherIndex]);
  const dateLabel = padWeatherNumber(target.day) + '/' + padWeatherNumber(target.month) + '/' + target.year;
  const timeLabel = padWeatherNumber(target.hour) + ':00';

  return '🌤️ *Dự báo thời tiết Hà Nội*\n\n' +
    '📅 *Thời điểm:* ' + timeLabel + ' ngày ' + dateLabel + '\n' +
    '🌡️ *Nhiệt độ:* ' + temp + '°C\n' +
    '💧 *Khả năng mưa:* ' + rainProb + '%\n' +
    '🌦️ *Trạng thái:* ' + status;
}

bot.command('weather', async (ctx) => {
  try {
    const input = getWeatherCommandArgument(ctx);

    if (input && !/^\d+$/.test(input)) {
      const target = parseSpecificWeatherTime(input);
      if (target.error) return ctx.reply(target.error);

      const hourly = await fetchHanoiHourlyWeather();
      const weatherIndex = hourly.time.indexOf(target.targetKey);
      if (weatherIndex === -1) {
        return ctx.reply('⚠️ Chưa có dữ liệu cho thời điểm này. Bot hiện xem được tối đa khoảng 16 ngày tới.');
      }

      return ctx.replyWithMarkdown(formatSpecificWeatherMessage(hourly, weatherIndex, target));
    }

    const hours = input ? Number(input) : 6;
    if (!Number.isInteger(hours) || hours < 1 || hours > 48) {
      return ctx.reply('⚠️ Số giờ phải từ 1 đến 48. Ví dụ: /weather 6');
    }

    const hourly = await fetchHanoiHourlyWeather();
    const nowParts = getHanoiDateTimeParts();
    const currentHourKey = nowParts.year + '-' + nowParts.month + '-' + nowParts.day +
      'T' + nowParts.hour + ':00';

    let weatherStartIndex = hourly.time.findIndex((time) => time >= currentHourKey);
    if (weatherStartIndex === -1) weatherStartIndex = 0;

    let message = '🌤️ *Dự báo thời tiết Hà Nội (' + hours + ' giờ tới)*\n\n';
    const weatherEndIndex = Math.min(weatherStartIndex + hours, hourly.time.length);

    for (let index = weatherStartIndex; index < weatherEndIndex; index++) {
      const timePart = hourly.time[index].split('T')[1];
      const temp = hourly.temperature_2m[index];
      const rainProb = hourly.precipitation_probability[index];
      const status = decodeWeatherCode(hourly.weathercode[index]);

      message += '🕒 *' + timePart + '* | 🌡️ *' + temp + '°C* | 💧 *Mưa: ' + rainProb + '%* | ' + status + '\n';
    }

    return ctx.replyWithMarkdown(message);
  } catch (error) {
    console.error('Weather command error:', error.message);
    return ctx.reply('❌ Lỗi khi lấy dữ liệu thời tiết: ' + error.message);
  }
});`;

source = source.slice(0, startIndex) + newWeatherBlock + '\n\n' + source.slice(endIndex);
fs.writeFileSync(indexPath, source, 'utf8');
console.log('Đã thêm cú pháp /weather theo ngày giờ cụ thể');
