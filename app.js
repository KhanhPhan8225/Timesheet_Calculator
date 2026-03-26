(() => {
    'use strict';

    // ── DOM refs ──────────────────────────────────────
    const $ = (sel) => document.querySelector(sel);
    const dataInput = $('#dataInput');
    const hourlyRateInput = $('#hourlyRate');
    const resultDiv = $('#result');
    const rateBtns = document.querySelectorAll('.rate-btn');

    // ── LocalStorage keys ────────────────────────────
    const STORAGE_RATE = 'ts_hourly_rate';
    const STORAGE_THEME = 'ts_theme';

    // ── Theme (Dark Mode) ────────────────────────────
    function initTheme() {
        const saved = localStorage.getItem(STORAGE_THEME);
        if (saved) {
            document.documentElement.setAttribute('data-theme', saved);
        } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
        updateThemeIcon();
    }

    function toggleDarkMode() {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem(STORAGE_THEME, next);
        updateThemeIcon();
    }

    function updateThemeIcon() {
        const btn = $('#btnTheme');
        if (!btn) return;
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        btn.textContent = isDark ? '☀️' : '🌙';
        btn.setAttribute('aria-label', isDark ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối');
    }

    // ── LocalStorage: Rate ───────────────────────────
    function loadSavedRate() {
        const saved = localStorage.getItem(STORAGE_RATE);
        if (saved) {
            hourlyRateInput.value = saved;
            highlightRateBtn(parseFloat(saved));
        }
    }

    function saveRate(rate) {
        if (rate > 0) localStorage.setItem(STORAGE_RATE, rate);
    }

    // ── Rate buttons ──────────────────────────────────
    function setRate(rate) {
        hourlyRateInput.value = rate;
        saveRate(rate);
        highlightRateBtn(rate);
        autoCalculate();
    }

    function highlightRateBtn(rate) {
        rateBtns.forEach((btn) => {
            const btnRate = parseFloat(btn.dataset.rate);
            btn.classList.toggle('active', btnRate === rate);
        });
    }

    // ── Parsing (handles multiline cell pastes correctly) ──────
    function parseEntries(raw) {
        // Normalize entire input: clean up tabs, multiple spaces, keep it all as one string
        // so we don't rely on newlines (which get broken during copy/paste from tables)
        const normalized = raw.replace(/,/g, '.').replace(/\s+/g, ' ');
        const entries = [];
        
        // Find all "Ngày Thứ" markers. e.g., "01 CN", "02 T2"
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
        
        // If no days found, might be an empty or invalid paste
        if (dayIndices.length === 0) return entries;
        
        // Process each chunk (from one "Ngày" to the next)
        for (let i = 0; i < dayIndices.length; i++) {
            const current = dayIndices[i];
            const nextIndex = i + 1 < dayIndices.length ? dayIndices[i + 1].index : normalized.length;
            
            // The text block belonging to this specific day
            const chunk = normalized.substring(current.index, nextIndex);
            
            // Look for times (HH:MM). There are usually 3 to 4 times (Từ, Nghỉ(opt), Vào, Đến)
            const timeMatches = chunk.match(/\b\d{1,2}:\d{2}\b/g);
            if (!timeMatches || timeMatches.length === 0) continue;
            
            const endTime = timeMatches[timeMatches.length - 1]; // Last time is "Đến" (End Time)
            const parts = endTime.split(':');
            const endHour = parseInt(parts[0], 10);
            
            // Get text *after* the last time to find the "Tổng giờ làm" and "Vị trí"
            const afterTimeStr = chunk.substring(chunk.lastIndexOf(endTime) + endTime.length);
            
            // Decimal numbers list: Tổng, Đêm, TổngOT, ĐêmOT, Ngày công
            const decimalMatches = afterTimeStr.match(/\b\d+\.\d{1,2}\b/g);
            if (!decimalMatches) continue;
            
            // The first decimal after all the times is the "Tổng giờ làm"
            const hoursValue = parseFloat(decimalMatches[0]);
            if (isNaN(hoursValue) || hoursValue <= 0 || hoursValue > 24) continue;
            
            // Look for Cook/Bếp anywhere in the chunk
            const position = /\b(cook|bếp)\b/i.test(chunk) ? 'Cook' : null;
            
            entries.push({
                day: current.dayNum,
                dayName: current.dayName,
                hours: hoursValue,
                endTime: endTime,
                endHour: endHour,
                position: position,
                label: `${current.dayNum} ${current.dayName}`,
            });
        }

        return entries;
    }

    // ── Money formatter ───────────────────────────────
    function formatMoney(amount) {
        return new Intl.NumberFormat('vi-VN').format(Math.round(amount)) + ' VNĐ';
    }

    // ── Build bar chart HTML ──────────────────────────
    function buildChartHTML(entries) {
        const maxHours = Math.max(...entries.map((e) => e.hours));

        const bars = entries
            .map((entry, i) => {
                const pct = (entry.hours / maxHours) * 100;
                const label = entry.label || `Ngày ${i + 1}`;
                let colorClass = 'chart-fill--green';
                if (entry.hours >= 8) colorClass = 'chart-fill--red';
                else if (entry.hours >= 6) colorClass = 'chart-fill--orange';

                return `
                <div class="chart-row">
                    <span class="chart-label">${label}</span>
                    <div class="chart-bar">
                        <div class="chart-fill ${colorClass}" style="--fill-width: ${pct}%; animation-delay: ${i * 0.06}s">
                            <span class="chart-value">${entry.hours}h</span>
                        </div>
                    </div>
                </div>`;
            })
            .join('');

        return `
            <div class="chart-section">
                <h3 class="chart-title">📊 Biểu đồ giờ làm việc</h3>
                ${bars}
                <div class="chart-legend">
                    <span class="legend-item"><span class="legend-dot legend-dot--green"></span> &lt; 6h</span>
                    <span class="legend-item"><span class="legend-dot legend-dot--orange"></span> 6-8h</span>
                    <span class="legend-item"><span class="legend-dot legend-dot--red"></span> &gt; 8h</span>
                </div>
            </div>`;
    }

    // ── Build salary HTML ─────────────────────────────
    function buildSalaryHTML(total, hourlyRate, entryCount, cookBonus) {
        if (hourlyRate <= 0) return '';

        const gross = total * hourlyRate;
        const totalWithBonus = gross + cookBonus;
        const avgPerDay = totalWithBonus / entryCount;

        const cookBonusHTML = cookBonus > 0
            ? `<div class="salary-detail cook-bonus">
                    🍳 Thưởng đóng ca Cook: <strong>+${formatMoney(cookBonus)}</strong>
               </div>`
            : '';

        return `
            <div class="salary-card">
                <h2 class="salary-title">💵 LƯƠNG DỰ KIẾN (THAM KHẢO)</h2>
                <div class="salary-detail">
                    <strong>${total.toFixed(2)} giờ × ${formatMoney(hourlyRate).replace(' VNĐ', '')} VNĐ/giờ = ${formatMoney(gross)}</strong>
                </div>
                ${cookBonusHTML}
                <div class="salary-total">🎯 Tổng lương: ${formatMoney(totalWithBonus)}</div>
                <div class="salary-avg">Lương trung bình/ngày: ${formatMoney(avgPerDay)}</div>
                <div class="salary-disclaimer">
                    ⚠️ Số tiền trên chỉ mang tính chất tham khảo, chưa bao gồm khấu trừ bảo hiểm, thuế,...
                </div>
            </div>`;
    }

    // ── Build result HTML ─────────────────────────────
    function buildResultHTML(entries, total, salaryHTML, chartHTML) {
        const daysList = entries
            .map((e, i) => {
                const label = e.label || `Ngày ${i + 1}`;
                const cookTag = e.isCookClosing ? ' 🍳' : '';
                return `${label}: ${e.hours} giờ${cookTag}`;
            })
            .join('<br>');
        const avg = (total / entries.length).toFixed(2);

        return `
            <div class="result">
                <h3>✅ Kết quả tính toán</h3>
                <div class="hours-list">
                    <strong>Giờ làm việc từng ngày:</strong><br>
                    ${daysList}
                </div>
                <h2 class="total-hours">
                    🕐 Tổng cộng: <span>${total.toFixed(2)} giờ</span>
                </h2>
                <p class="stats">
                    Số ngày làm việc: ${entries.length} ngày<br>
                    Trung bình: ${avg} giờ/ngày
                </p>
                ${chartHTML}
                ${salaryHTML}
            </div>`;
    }

    // ── Main calculation ──────────────────────────────
    function calculateHours() {
        const input = dataInput.value;
        const hourlyRate = parseFloat(hourlyRateInput.value) || 0;

        if (!input.trim()) {
            resultDiv.innerHTML = '<div class="error">Vui lòng paste dữ liệu vào ô trên!</div>';
            return;
        }

        try {
            const entries = parseEntries(input);

            if (entries.length === 0) {
                resultDiv.innerHTML = '<div class="error">Không tìm thấy dữ liệu giờ làm việc! Vui lòng kiểm tra lại dữ liệu.</div>';
                return;
            }

            // Mark cook closing shifts & calculate bonus
            let cookClosingDays = 0;
            entries.forEach((e) => {
                const isCook = e.position && e.position.toLowerCase().includes('cook');
                e.isCookClosing = isCook && e.endHour !== null && e.endHour >= 21;
                if (e.isCookClosing) cookClosingDays++;
            });
            const cookBonus = cookClosingDays * 15000;

            const total = entries.reduce((sum, e) => sum + e.hours, 0);
            const chartHTML = buildChartHTML(entries);
            const salaryHTML = buildSalaryHTML(total, hourlyRate, entries.length, cookBonus);

            resultDiv.innerHTML = buildResultHTML(entries, total, salaryHTML, chartHTML);

            resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch {
            resultDiv.innerHTML = '<div class="error">Có lỗi xảy ra khi xử lý dữ liệu. Vui lòng kiểm tra định dạng!</div>';
        }
    }

    // ── Clear all ─────────────────────────────────────
    function clearAll() {
        dataInput.value = '';
        hourlyRateInput.value = '';
        resultDiv.innerHTML = '';
        rateBtns.forEach((btn) => btn.classList.remove('active'));
        localStorage.removeItem(STORAGE_RATE);
    }

    // ── Load example ──────────────────────────────────
    function loadExample() {
        dataInput.value = [
            '01\tCN\tW\t10:00\t14:00\t18:00\t22:00\t8.00\t0.00\t0.00\t0.00\t1.00\tĐã duyệt\tPass\tParttime - PA1\tCrew\t083-HNYP\tLobby',
            '02\tT2\tW\t17:00\t\t\t22:00\t5.00\t0.00\t0.00\t0.00\t1.00\tĐã duyệt\tPass\tParttime - PA1\tCrew\t083-HNYP\tLobby',
            '03\tT3\tW\t17:30\t\t\t22:30\t5.00\t0.00\t0.00\t0.00\t1.00\tĐã duyệt\tPass\tParttime - PA1\tCook\t083-HNYP\tKitchen',
            '04\tT4\tW\t17:00\t\t\t22:30\t5.50\t0.00\t0.00\t0.00\t1.00\tĐã duyệt\tPass\tParttime - PA1\tCook\t083-HNYP\tKitchen',
            '05\tT5\tW\t17:00\t\t\t22:00\t5.00\t0.00\t0.00\t0.00\t1.00\tĐã duyệt\tPass\tParttime - PA1\tCrew\t083-HNYP\tLobby',
            '06\tT6\tW\t13:00\t14:00\t18:00\t22:30\t5.50\t0.00\t0.00\t0.00\t1.00\tĐã duyệt\tPass\tParttime - PA1\tCook\t083-HNYP\tKitchen',
            '07\tT7\tW\t16:00\t\t\t20:00\t4.00\t0.00\t0.00\t0.00\t1.00\tĐã duyệt\tPass\tParttime - PA1\tCook\t083-HNYP\tKitchen',
        ].join('\n');

        autoCalculate();
    }

    // ── Auto calculate helper ─────────────────────────
    function autoCalculate() {
        if (dataInput.value.trim()) {
            setTimeout(calculateHours, 50);
        }
    }

    // ── Event listeners ───────────────────────────────
    $('#btnCalculate').addEventListener('click', calculateHours);
    $('#btnClear').addEventListener('click', clearAll);
    $('#btnExample').addEventListener('click', loadExample);
    $('#btnTheme').addEventListener('click', toggleDarkMode);

    rateBtns.forEach((btn) => {
        btn.addEventListener('click', () => setRate(parseFloat(btn.dataset.rate)));
    });

    dataInput.addEventListener('paste', () => setTimeout(calculateHours, 100));

    hourlyRateInput.addEventListener('input', () => {
        const rate = parseFloat(hourlyRateInput.value) || 0;
        saveRate(rate);
        highlightRateBtn(rate);
        autoCalculate();
    });

    // ── Init ──────────────────────────────────────────
    initTheme();
    loadSavedRate();
})();
