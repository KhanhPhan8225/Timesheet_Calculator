const TelegramBot = require('node-telegram-bot-api');
const { scrapeTimesheet } = require('./scraper');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
    console.warn('⚠️ TELEGRAM_BOT_TOKEN not set — Telegram Bot disabled.');
    module.exports = null;
    return;
}

const bot = new TelegramBot(TOKEN, { polling: true });
const HTML = { parse_mode: 'HTML' };

// ── Persistent storage ──────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'telegram-accounts.json');
const RATES_FILE = path.join(DATA_DIR, 'telegram-rates.json');

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSON(filepath) {
    try {
        if (fs.existsSync(filepath)) return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    } catch { /* corrupted file — start fresh */ }
    return {};
}

function saveJSON(filepath, data) {
    ensureDataDir();
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
}

// ── Per-user state ──────────────────────────────────
// States: idle | awaiting_username | awaiting_password | awaiting_paste | processing
const sessions = new Map();
const savedAccounts = loadJSON(ACCOUNTS_FILE);   // { chatId: [{ username, password, name }] }
const userRates = loadJSON(RATES_FILE);           // { chatId: rate }
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_ACCOUNTS = 5;

function getAccounts(chatId) {
    return savedAccounts[chatId] || [];
}

function saveAccount(chatId, username, password, name) {
    let accounts = getAccounts(chatId);
    accounts = accounts.filter(a => a.username !== username);
    accounts.unshift({ username, password, name });
    if (accounts.length > MAX_ACCOUNTS) accounts.pop();
    savedAccounts[chatId] = accounts;
    saveJSON(ACCOUNTS_FILE, savedAccounts);
}

function removeAccount(chatId, username) {
    let accounts = getAccounts(chatId);
    accounts = accounts.filter(a => a.username !== username);
    savedAccounts[chatId] = accounts;
    saveJSON(ACCOUNTS_FILE, savedAccounts);
}

function getUserRate(chatId) {
    return userRates[chatId] || 0;
}

function setUserRate(chatId, rate) {
    userRates[chatId] = rate;
    saveJSON(RATES_FILE, userRates);
}

function getSession(chatId) {
    return sessions.get(chatId) || { state: 'idle' };
}

function setSession(chatId, data) {
    clearSessionTimer(chatId);
    const timer = setTimeout(() => {
        sessions.delete(chatId);
    }, SESSION_TIMEOUT_MS);
    sessions.set(chatId, { ...data, _timer: timer });
}

function clearSession(chatId) {
    clearSessionTimer(chatId);
    sessions.delete(chatId);
}

function clearSessionTimer(chatId) {
    const s = sessions.get(chatId);
    if (s && s._timer) clearTimeout(s._timer);
}

// ── Parsing (ported from app.js) ────────────────────
const DAY_NAMES = {
    'CN': 'Chủ Nhật', 'T2': 'Thứ Hai', 'T3': 'Thứ Ba',
    'T4': 'Thứ Tư', 'T5': 'Thứ Năm', 'T6': 'Thứ Sáu', 'T7': 'Thứ Bảy',
};

function parseEntries(raw) {
    const normalized = raw.replace(/,/g, '.').replace(/\s+/g, ' ');
    const entries = [];
    const dayRegex = /\b(\d{1,2})\s+(CN|T[2-7])\b/g;
    let dayMatch;
    const dayIndices = [];

    while ((dayMatch = dayRegex.exec(normalized)) !== null) {
        dayIndices.push({
            index: dayMatch.index,
            dayNum: dayMatch[1].padStart(2, '0'),
            dayName: dayMatch[2]
        });
    }
    if (dayIndices.length === 0) return entries;

    for (let i = 0; i < dayIndices.length; i++) {
        const current = dayIndices[i];
        const nextIndex = i + 1 < dayIndices.length ? dayIndices[i + 1].index : normalized.length;
        const chunk = normalized.substring(current.index, nextIndex);

        const timeMatches = chunk.match(/\b\d{1,2}:\d{2}\b/g);
        if (!timeMatches || timeMatches.length === 0) continue;

        const endTime = timeMatches[timeMatches.length - 1];
        const parts = endTime.split(':');
        const endHour = parseInt(parts[0], 10);

        const afterTimeStr = chunk.substring(chunk.lastIndexOf(endTime) + endTime.length);
        const decimalMatches = afterTimeStr.match(/\b\d+\.\d{1,2}\b/g);
        if (!decimalMatches) continue;

        let hoursValue = parseFloat(decimalMatches[0]);
        if (isNaN(hoursValue) || hoursValue <= 0 || hoursValue > 24) continue;
        hoursValue = Math.round(hoursValue * 4) / 4;

        const position = /\b(cook|bếp)\b/i.test(chunk) ? 'Cook' : null;
        const startTime = timeMatches[0];
        const isCookClosing = position && position.toLowerCase().includes('cook') && endHour >= 21;

        entries.push({
            day: current.dayNum,
            dayName: current.dayName,
            hours: hoursValue,
            startTime,
            endTime,
            endHour,
            position,
            isCookClosing,
        });
    }
    return entries;
}

function formatTime(t) {
    const [h, m] = t.split(':');
    return `${String(parseInt(h, 10)).padStart(2, '0')}:${m}`;
}

function formatMoney(amount) {
    return new Intl.NumberFormat('vi-VN').format(Math.round(amount));
}

// ── HTML escape (only need to escape <, >, &) ───────
function esc(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Build Telegram result message (HTML) ────────────
function buildResultMessage(entries, employeeName, hourlyRate) {
    const total = entries.reduce((sum, e) => sum + e.hours, 0);
    const avg = (total / entries.length).toFixed(2);
    const cookClosingDays = entries.filter(e => e.isCookClosing).length;
    const cookBonus = cookClosingDays * 15000;

    let msg = `📊 <b>BẢNG CÔNG — ${esc(employeeName)}</b>\n\n`;

    // Table rows in <pre> block
    msg += '<pre>\n';
    msg += pad('Ngày', 12) + pad('Vào', 7) + pad('Ra', 7) + pad('Giờ', 5) + '\n';
    msg += '─'.repeat(31) + '\n';

    for (const e of entries) {
        const dayLabel = `${e.dayName} (${e.day})`;
        const cookIcon = e.isCookClosing ? '🍳' : '';
        msg += pad(dayLabel + cookIcon, 12)
            + pad(formatTime(e.startTime), 7)
            + pad(formatTime(e.endTime), 7)
            + pad(String(e.hours), 5) + '\n';
    }
    msg += '─'.repeat(31) + '\n';
    msg += pad('TỔNG', 26) + pad(String(total), 5) + '\n';
    msg += '</pre>\n\n';

    // Summary
    msg += `📈 <b>Tổng kết:</b>\n`;
    msg += `• Ngày làm: <b>${entries.length}</b> ngày\n`;
    msg += `• Tổng giờ: <b>${total}h</b>\n`;
    msg += `• Trung bình: <b>${avg}h/ngày</b>\n`;

    // Salary
    if (hourlyRate && hourlyRate > 0) {
        const gross = total * hourlyRate;
        const totalWithBonus = gross + cookBonus;

        msg += `\n💰 <b>Lương tạm tính</b> (${formatMoney(hourlyRate)} VNĐ/h):\n`;
        msg += `• Lương cơ bản: ${formatMoney(gross)} VNĐ\n`;
        if (cookBonus > 0) {
            msg += `• Thưởng Cook đóng ca: +${formatMoney(cookBonus)} VNĐ (${cookClosingDays} ca)\n`;
        }
        msg += `• 💵 <b>THỰC NHẬN: ${formatMoney(totalWithBonus)} VNĐ</b>\n`;
        msg += `\n<i>⚠️ Số tiền chỉ mang tính chất tham khảo</i>`;
    } else {
        msg += `\n💡 <i>Gửi /setrate &lt;số&gt; để tính lương. VD: /setrate 25000</i>`;
    }

    return msg;
}

function pad(str, len) {
    if (str.length >= len) return str;
    return str + ' '.repeat(len - str.length);
}

// ── Delete message safely ───────────────────────────
async function tryDeleteMessage(chatId, messageId) {
    try {
        await bot.deleteMessage(chatId, messageId);
    } catch {
        // Bot may lack permission to delete in groups — silently ignore
    }
}

// ── Command Handlers ────────────────────────────────

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    clearSession(chatId);
    bot.sendMessage(chatId,
        `👋 <b>Xin chào, ${esc(msg.from.first_name || 'bạn')}!</b>\n\n`
        + `Tôi là bot tra cứu <b>Bảng công KFC</b>.\n\n`
        + `📋 Các lệnh:\n`
        + `• /timesheet — Tự động lấy bảng công\n`
        + `• /paste — Nhập dữ liệu thủ công\n`
        + `• /setrate &lt;số&gt; — Đặt lương/giờ\n`
        + `• /accounts — Quản lý tài khoản đã lưu\n`
        + `• /help — Hướng dẫn chi tiết\n\n`
        + `Bắt đầu ngay với /timesheet hoặc /paste 🚀`,
        HTML
    );
});

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    clearSession(chatId);
    bot.sendMessage(chatId,
        `📖 <b>HƯỚNG DẪN SỬ DỤNG</b>\n\n`
        + `<b>1. Tự động lấy bảng công:</b>\n`
        + `Gửi /timesheet → Nhập mã NV → Nhập mật khẩu\n`
        + `Bot sẽ tự đăng nhập KFC HR và lấy dữ liệu.\n`
        + `🔒 <i>Tin nhắn mật khẩu sẽ bị xóa ngay lập tức</i>\n\n`
        + `<b>2. Nhập thủ công (khi auto bị lỗi):</b>\n`
        + `Gửi /paste → Copy bảng công từ web → Dán vào chat\n\n`
        + `<b>3. Đặt lương/giờ:</b>\n`
        + `Gửi /setrate 25000 để tính lương tự động.\n`
        + `Rate được lưu cho các lần sau.\n\n`
        + `<b>4. Hủy thao tác:</b>\n`
        + `Gửi /cancel bất cứ lúc nào để quay về.\n\n`
        + `❓ Liên hệ admin nếu gặp vấn đề.`,
        HTML
    );
});

bot.onText(/\/cancel/, (msg) => {
    const chatId = msg.chat.id;
    clearSession(chatId);
    bot.sendMessage(chatId, '✅ Đã hủy. Gửi /timesheet hoặc /paste để bắt đầu lại.');
});

// ── /timesheet: Auto-fetch flow ─────────────────────
bot.onText(/\/timesheet/, (msg) => {
    const chatId = msg.chat.id;
    const session = getSession(chatId);

    if (session.state === 'processing') {
        bot.sendMessage(chatId, '⏳ Đang xử lý yêu cầu trước đó, vui lòng chờ...');
        return;
    }

    const accounts = getAccounts(chatId);

    if (accounts.length > 0) {
        const keyboard = accounts.map(acc => [
            { text: `👤 ${acc.name} (${acc.username})`, callback_data: `login:${acc.username}` }
        ]);
        keyboard.push([{ text: '➕ Tài khoản khác', callback_data: 'login:new' }]);

        bot.sendMessage(chatId,
            `📋 <b>Tra cứu Bảng công tự động</b>\n\n`
            + `Chọn tài khoản có sẵn hoặc nhập mới:`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } }
        );
    } else {
        setSession(chatId, { state: 'awaiting_username' });
        bot.sendMessage(chatId,
            `📋 <b>Tra cứu Bảng công tự động</b>\n\n`
            + `Nhập <b>Mã Nhân Viên</b> của bạn:`,
            HTML
        );
    }
});

// ── /accounts: Manage saved accounts ────────────────
bot.onText(/\/accounts/, (msg) => {
    const chatId = msg.chat.id;
    const accounts = getAccounts(chatId);

    if (accounts.length === 0) {
        bot.sendMessage(chatId, '📭 Chưa có tài khoản nào được lưu.\nSử dụng /timesheet để đăng nhập và lưu tài khoản.');
        return;
    }

    const keyboard = accounts.map(acc => [
        { text: `👤 ${acc.name} (${acc.username})`, callback_data: `login:${acc.username}` },
        { text: '🗑️ Xóa', callback_data: `del:${acc.username}` }
    ]);

    bot.sendMessage(chatId,
        `👥 <b>Tài khoản đã lưu</b> (${accounts.length}/${MAX_ACCOUNTS})\n\n`
        + `Nhấn vào tài khoản để tra cứu nhanh, hoặc nhấn 🗑️ để xóa:`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } }
    );
});

// ── Callback query handler (inline keyboard) ────────
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    // Delete account
    if (data.startsWith('del:')) {
        const username = data.substring(4);
        removeAccount(chatId, username);
        await bot.answerCallbackQuery(query.id, { text: `✅ Đã xóa tài khoản ${username}` });
        await bot.deleteMessage(chatId, query.message.message_id);

        const remaining = getAccounts(chatId);
        if (remaining.length > 0) {
            const keyboard = remaining.map(acc => [
                { text: `👤 ${acc.name} (${acc.username})`, callback_data: `login:${acc.username}` },
                { text: '🗑️ Xóa', callback_data: `del:${acc.username}` }
            ]);
            bot.sendMessage(chatId,
                `👥 <b>Tài khoản đã lưu</b> (${remaining.length}/${MAX_ACCOUNTS})`,
                { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } }
            );
        } else {
            bot.sendMessage(chatId, '📭 Đã xóa hết tài khoản.');
        }
        return;
    }

    // Login with new account
    if (data === 'login:new') {
        await bot.answerCallbackQuery(query.id);
        setSession(chatId, { state: 'awaiting_username' });
        bot.sendMessage(chatId, `Nhập <b>Mã Nhân Viên</b> của bạn:`, HTML);
        return;
    }

    // Login with saved account
    if (data.startsWith('login:')) {
        const username = data.substring(6);
        const accounts = getAccounts(chatId);
        const acc = accounts.find(a => a.username === username);

        if (!acc) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Tài khoản không tồn tại' });
            return;
        }

        await bot.answerCallbackQuery(query.id, { text: `⏳ Đang lấy bảng công ${acc.name}...` });
        setSession(chatId, { state: 'processing' });

        const loadingMsg = await bot.sendMessage(chatId,
            `⏳ Đang đăng nhập <b>${esc(acc.name)}</b> (${esc(acc.username)})...\n`
            + `<i>Vui lòng đợi 30-60 giây</i>`,
            HTML
        );

        try {
            const result = await scrapeTimesheet(acc.username, acc.password);

            if (!result.tableData || result.tableData.trim() === '') {
                await bot.editMessageText('❌ Bảng công trống hoặc không có dữ liệu.', {
                    chat_id: chatId, message_id: loadingMsg.message_id,
                });
                clearSession(chatId);
                return;
            }

            const entries = parseEntries(result.tableData);
            if (entries.length === 0) {
                await bot.editMessageText(
                    '❌ Không thể phân tích dữ liệu bảng công.\n\n💡 <i>Thử /paste để nhập thủ công</i>',
                    { chat_id: chatId, message_id: loadingMsg.message_id, parse_mode: 'HTML' }
                );
                clearSession(chatId);
                return;
            }

            // Update saved name if changed
            if (result.employeeName && result.employeeName !== acc.name) {
                saveAccount(chatId, acc.username, acc.password, result.employeeName);
            }

            const hourlyRate = getUserRate(chatId);
            const resultMsg = buildResultMessage(entries, result.employeeName, hourlyRate);
            await bot.editMessageText(resultMsg, {
                chat_id: chatId, message_id: loadingMsg.message_id, parse_mode: 'HTML',
            });
        } catch (err) {
            console.error('Telegram scrape error:', err.message);
            await bot.editMessageText(
                `❌ <b>Lỗi:</b> ${esc(err.message)}\n\n💡 <i>Thử lại với /timesheet hoặc /paste</i>`,
                { chat_id: chatId, message_id: loadingMsg.message_id, parse_mode: 'HTML' }
            );
        }
        clearSession(chatId);
        return;
    }
});

// ── /paste: Manual paste flow ───────────────────────
bot.onText(/\/paste/, (msg) => {
    const chatId = msg.chat.id;
    const session = getSession(chatId);

    if (session.state === 'processing') {
        bot.sendMessage(chatId, '⏳ Đang xử lý yêu cầu trước đó, vui lòng chờ...');
        return;
    }

    setSession(chatId, { state: 'awaiting_paste' });
    bot.sendMessage(chatId,
        `📋 <b>Nhập dữ liệu thủ công</b>\n\n`
        + `Hãy <b>copy toàn bộ bảng công</b> từ trang KFC HR rồi <b>dán vào đây</b>.\n\n`
        + `<i>Gửi /cancel để hủy</i>`,
        HTML
    );
});

// ── /setrate: Set hourly rate ───────────────────────
bot.onText(/\/setrate\s*(.*)/, (msg, match) => {
    const chatId = msg.chat.id;
    const rateStr = (match[1] || '').trim();

    if (!rateStr) {
        const current = getUserRate(chatId);
        if (current) {
            bot.sendMessage(chatId, `💰 Rate hiện tại: <b>${formatMoney(current)} VNĐ/h</b>\n\nĐể thay đổi: /setrate &lt;số&gt;`, HTML);
        } else {
            bot.sendMessage(chatId, '💰 Chưa đặt rate. Ví dụ: <code>/setrate 25000</code>', HTML);
        }
        return;
    }

    const rate = parseInt(rateStr.replace(/[.,]/g, ''), 10);
    if (isNaN(rate) || rate <= 0 || rate > 1000000) {
        bot.sendMessage(chatId, '❌ Rate không hợp lệ. Ví dụ: /setrate 25000');
        return;
    }

    setUserRate(chatId, rate);
    bot.sendMessage(chatId, `✅ Đã đặt lương: <b>${formatMoney(rate)} VNĐ/h</b>`, HTML);
});

// ── Message handler (conversation flow) ─────────────
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();

    // Ignore commands (handled by onText above)
    if (text.startsWith('/')) return;

    const session = getSession(chatId);

    // ── Auto-fetch: Step 1 — Receive username
    if (session.state === 'awaiting_username') {
        setSession(chatId, { state: 'awaiting_password', username: text });
        bot.sendMessage(chatId,
            `🔑 Nhập <b>Mật Khẩu</b> HR:\n\n`
            + `🔒 <i>Tin nhắn sẽ được xóa ngay sau khi nhận</i>`,
            HTML
        );
        return;
    }

    // ── Auto-fetch: Step 2 — Receive password & scrape
    if (session.state === 'awaiting_password') {
        // Delete password message immediately
        await tryDeleteMessage(chatId, msg.message_id);

        const { username } = session;
        setSession(chatId, { state: 'processing' });

        const loadingMsg = await bot.sendMessage(chatId,
            `⏳ Đang đăng nhập KFC HR và lấy bảng công...\n`
            + `<i>Vui lòng đợi 30-60 giây</i>`,
            HTML
        );

        try {
            const result = await scrapeTimesheet(username, text);

            if (!result.tableData || result.tableData.trim() === '') {
                await bot.editMessageText('❌ Bảng công trống hoặc không có dữ liệu.', {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id,
                });
                clearSession(chatId);
                return;
            }

            const entries = parseEntries(result.tableData);

            if (entries.length === 0) {
                await bot.editMessageText(
                    '❌ Không thể phân tích dữ liệu bảng công.\n\n💡 <i>Thử /paste để nhập thủ công</i>',
                    {
                        chat_id: chatId,
                        message_id: loadingMsg.message_id,
                        parse_mode: 'HTML',
                    }
                );
                clearSession(chatId);
                return;
            }

            // Save account on successful login
            if (result.employeeName) {
                saveAccount(chatId, username, text, result.employeeName);
            }

            const hourlyRate = getUserRate(chatId);
            const resultMsg = buildResultMessage(entries, result.employeeName, hourlyRate);

            await bot.editMessageText(resultMsg, {
                chat_id: chatId,
                message_id: loadingMsg.message_id,
                parse_mode: 'HTML',
            });
        } catch (err) {
            console.error('Telegram scrape error:', err.message);
            const errorText = `❌ <b>Lỗi:</b> ${esc(err.message)}\n\n`
                + `💡 <i>Thử lại với /timesheet hoặc dùng /paste để nhập thủ công</i>`;

            await bot.editMessageText(errorText, {
                chat_id: chatId,
                message_id: loadingMsg.message_id,
                parse_mode: 'HTML',
            });
        }
        clearSession(chatId);
        return;
    }

    // ── Manual paste: Receive raw data
    if (session.state === 'awaiting_paste') {
        setSession(chatId, { state: 'processing' });

        const entries = parseEntries(text);

        if (entries.length === 0) {
            bot.sendMessage(chatId,
                '❌ Không tìm thấy dữ liệu giờ làm!\n\n'
                + 'Hãy đảm bảo bạn đã copy <b>toàn bộ bảng công</b> từ trang web.\n'
                + '<i>Thử lại: /paste</i>',
                HTML
            );
            clearSession(chatId);
            return;
        }

        const hourlyRate = getUserRate(chatId);
        const resultMsg = buildResultMessage(entries, 'Nhập thủ công', hourlyRate);

        bot.sendMessage(chatId, resultMsg, HTML);
        clearSession(chatId);
        return;
    }

    // No active session — hint the user
    if (text.length > 5) {
        bot.sendMessage(chatId,
            '💡 Gửi /timesheet để tra cứu tự động hoặc /paste để nhập thủ công.'
        );
    }
});

// ── Error handling ──────────────────────────────────
bot.on('polling_error', (err) => {
    if (bot._shuttingDown) return;
    console.error('Telegram polling error:', err.code, err.message);
});

// ── Graceful shutdown ───────────────────────────────
function gracefulShutdown() {
    if (bot._shuttingDown) return;
    bot._shuttingDown = true;
    console.log('🛑 Stopping Telegram Bot...');
    bot.stopPolling().then(() => {
        console.log('✅ Telegram Bot stopped.');
        process.exit(0);
    }).catch(() => {
        process.exit(1);
    });
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

console.log('🤖 Telegram Bot is running...');
module.exports = bot;
