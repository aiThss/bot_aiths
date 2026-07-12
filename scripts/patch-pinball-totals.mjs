import fs from 'node:fs';

const indexPath = new URL('../index.js', import.meta.url);
let source = fs.readFileSync(indexPath, 'utf8');

const routeMarker = "app.post('/webhook/pinball', async (req, res) => {";
const helperMarker = 'async function fetchPinballCustomerTotals(payload) {';

if (!source.includes(helperMarker)) {
  const routeIndex = source.indexOf(routeMarker);
  if (routeIndex === -1) {
    throw new Error('Không tìm thấy webhook Pinball để thêm tổng thẻ và bi');
  }

  const helpers = String.raw`function parsePinballTotalText(value) {
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
    endpoint.searchParams.set('status', 'Đang gửi');
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

`;

  source = source.slice(0, routeIndex) + helpers + source.slice(routeIndex);
}

const totalsLookupMarker = '    const customerTotals = await fetchPinballCustomerTotals(payload);';
if (!source.includes(totalsLookupMarker)) {
  const actionFallback = "if (actionLines.length === 0) actionLines.push('• <b>Thao tác:</b> Không thay đổi thẻ hoặc bi');\n\n";
  if (!source.includes(actionFallback)) {
    throw new Error('Không tìm thấy vị trí tính tổng thẻ và bi trong webhook Pinball');
  }

  source = source.replace(actionFallback, actionFallback + totalsLookupMarker + '\n\n');
}

const totalLineMarker = '      formatPinballTotalLine(customerTotals),';
if (!source.includes(totalLineMarker)) {
  const actionLinesEntry = '...actionLines,\n';
  if (!source.includes(actionLinesEntry)) {
    throw new Error('Không tìm thấy vị trí hiển thị tổng thẻ và bi trong tin nhắn Pinball');
  }

  source = source.replace(actionLinesEntry, actionLinesEntry + totalLineMarker + '\n');
}

fs.writeFileSync(indexPath, source, 'utf8');
console.log('Đã thêm tổng thẻ và bi hiện có của khách vào thông báo Pinball');
