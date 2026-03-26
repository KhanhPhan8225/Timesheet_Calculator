(() => {
    'use strict';

    // ── DOM refs ──────────────────────────────────────
    const $ = (sel) => document.querySelector(sel);
    const dataInput = $('#dataInput');
    const hourlyRateInput = $('#hourlyRate');
    const resultDiv = $('#result');
    const summaryDiv = $('#summary-card');
    const recalcDiv = $('#recalc-area');
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
    }

    function toggleDarkMode() {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem(STORAGE_THEME, next);
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
            
            // Lấy tròn giờ theo tỷ lệ 1/4 (0.25, 0.5, 0.75)
            hoursValue = Math.round(hoursValue * 4) / 4;

            const position = /\b(cook|bếp)\b/i.test(chunk) ? 'Cook' : null;
            const startTime = timeMatches[0];

            entries.push({
                day: current.dayNum,
                dayName: current.dayName,
                hours: hoursValue,
                startTime: startTime,
                endTime: endTime,
                endHour: endHour,
                position: position,
                label: `${current.dayNum} ${current.dayName}`,
            });
        }

        return entries;
    }

    // ── Day name mapping ─────────────────────────────
    const DAY_NAMES = {
        'CN': 'Chủ Nhật',
        'T2': 'Thứ Hai',
        'T3': 'Thứ Ba',
        'T4': 'Thứ Tư',
        'T5': 'Thứ Năm',
        'T6': 'Thứ Sáu',
        'T7': 'Thứ Bảy',
    };

    function formatTime(t) {
        const [h, m] = t.split(':');
        return `${String(parseInt(h, 10)).padStart(2, '0')}:${m}`;
    }

    // ── Money formatter ───────────────────────────────
    function formatMoney(amount) {
        return new Intl.NumberFormat('vi-VN').format(Math.round(amount)) + ' VNĐ';
    }

    function formatMoneyShort(amount) {
        return new Intl.NumberFormat('vi-VN').format(Math.round(amount));
    }

    // ── Build detail table rows ──────────────────────
    function buildTableHTML(entries) {
        const rows = entries.map((e) => {
            const dayFull = DAY_NAMES[e.dayName] || e.dayName;
            const cookTag = e.isCookClosing
                ? '<span class="cook-tag">Cook</span>'
                : '';
            return `<tr>
                <td class="day-name">${dayFull} (${e.day}/${new Date().getMonth() + 1 < 10 ? '0' : ''}${new Date().getMonth() + 1})${cookTag}</td>
                <td>${formatTime(e.startTime)}</td>
                <td>${formatTime(e.endTime)}</td>
                <td class="hours-value">${e.hours}</td>
            </tr>`;
        }).join('');

        return `<table class="detail-table">
            <thead>
                <tr>
                    <th>Ngày trong tuần</th>
                    <th>Bắt đầu</th>
                    <th>Kết thúc</th>
                    <th style="text-align:right">Số giờ</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;
    }

    // ── Build bar chart HTML ──────────────────────────
    function buildChartHTML(entries) {
        const maxHours = Math.max(...entries.map((e) => e.hours));
        const bars = entries.map((entry, i) => {
            const pct = (entry.hours / maxHours) * 100;
            const label = entry.label || `Ngày ${i + 1}`;
            let colorClass = 'chart-fill--green';
            if (entry.hours >= 8) colorClass = 'chart-fill--red';
            else if (entry.hours >= 6) colorClass = 'chart-fill--orange';

            return `<div class="chart-row">
                <span class="chart-label">${label}</span>
                <div class="chart-bar">
                    <div class="chart-fill ${colorClass}" style="--fill-width: ${pct}%; animation-delay: ${i * 0.06}s">
                        <span class="chart-value">${entry.hours}h</span>
                    </div>
                </div>
            </div>`;
        }).join('');

        return `<div class="chart-section">
            <h3 class="chart-title">Biểu đồ giờ làm việc</h3>
            ${bars}
            <div class="chart-legend">
                <span class="legend-item"><span class="legend-dot legend-dot--green"></span> &lt; 6h</span>
                <span class="legend-item"><span class="legend-dot legend-dot--orange"></span> 6-8h</span>
                <span class="legend-item"><span class="legend-dot legend-dot--red"></span> &gt; 8h</span>
            </div>
        </div>`;
    }

    // ── Build sidebar summary HTML ───────────────────
    function buildSummaryHTML(total, hourlyRate, entryCount, cookBonus) {
        const gross = hourlyRate > 0 ? total * hourlyRate : 0;
        const totalWithBonus = gross + cookBonus;

        const salarySection = hourlyRate > 0 ? `
            <div class="summary-salary-label">Mức lương tạm tính</div>
            <div class="summary-salary-value">${formatMoneyShort(gross)} <span class="summary-total-currency">VNĐ</span></div>
            ${cookBonus > 0 ? `
            <div class="summary-extras">
                <div class="summary-extra-row">
                    <span>Thưởng đóng ca Cook</span>
                    <span class="summary-extra-value">+ ${formatMoneyShort(cookBonus)}</span>
                </div>
            </div>` : ''}
            <div class="summary-total-section">
                <div class="summary-total-label">THỰC NHẬN (TỔNG)</div>
                <div class="summary-total-value">${formatMoneyShort(totalWithBonus)} <span class="summary-total-currency">VNĐ</span></div>
            </div>
            <div class="salary-disclaimer">Số tiền trên chỉ mang tính chất tham khảo, chưa bao gồm khấu trừ bảo hiểm, thuế,...</div>
        ` : '';

        return `<div class="summary-card">
            <div class="summary-label">TỔNG HỢP KẾT QUẢ</div>
            <div>
                <span class="summary-label" style="margin-bottom:0">Tổng số giờ làm việc</span>
                <div class="summary-value">${total} <span class="summary-unit">Giờ</span></div>
            </div>
            ${salarySection}
        </div>`;
    }

    // ── Build recalculate button ─────────────────────
    function buildRecalcHTML() {
        return `<div class="recalc-card">
            <button type="button" class="btn-cta" id="btnRecalc">
                <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                <div>
                    <span>Tính toán lại</span>
                    <span class="btn-sub">CẬP NHẬT DỮ LIỆU MỚI NHẤT</span>
                </div>
            </button>
        </div>`;
    }

    // ── Build result HTML ─────────────────────────────
    function buildResultHTML(entries, total) {
        const avg = (total / entries.length).toFixed(2);
        const tableHTML = buildTableHTML(entries);
        const chartHTML = buildChartHTML(entries);

        return `<section class="card result-card">
            <div class="result-card-header">
                <h2>
                    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    Chi tiết thời gian làm việc (Tuần này)
                </h2>
                <span class="status-badge"><span class="status-dot"></span> Hệ thống đang chạy</span>
            </div>
            ${tableHTML}
            <div class="stats-row">
                <div class="stat-item">
                    <div class="stat-value">${entries.length}</div>
                    <div class="stat-label">Ngày làm việc</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${total}h</div>
                    <div class="stat-label">Tổng giờ</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${avg}h</div>
                    <div class="stat-label">Trung bình/ngày</div>
                </div>
            </div>
            ${chartHTML}
        </section>`;
    }

    // ── Main calculation ──────────────────────────────
    function calculateHours() {
        const input = dataInput.value;
        const hourlyRate = parseFloat(hourlyRateInput.value) || 0;

        if (!input.trim()) {
            resultDiv.innerHTML = '<div class="error">Vui lòng paste dữ liệu vào ô trên!</div>';
            summaryDiv.innerHTML = '';
            recalcDiv.innerHTML = '';
            return;
        }

        try {
            const entries = parseEntries(input);

            if (entries.length === 0) {
                resultDiv.innerHTML = '<div class="error">Không tìm thấy dữ liệu giờ làm việc! Vui lòng kiểm tra lại dữ liệu.</div>';
                summaryDiv.innerHTML = '';
                recalcDiv.innerHTML = '';
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

            resultDiv.innerHTML = buildResultHTML(entries, total);
            summaryDiv.innerHTML = buildSummaryHTML(total, hourlyRate, entries.length, cookBonus);
            recalcDiv.innerHTML = buildRecalcHTML();

            // Bind recalc button
            const recalcBtn = $('#btnRecalc');
            if (recalcBtn) recalcBtn.addEventListener('click', calculateHours);

            resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch {
            resultDiv.innerHTML = '<div class="error">Có lỗi xảy ra khi xử lý dữ liệu. Vui lòng kiểm tra định dạng!</div>';
            summaryDiv.innerHTML = '';
            recalcDiv.innerHTML = '';
        }
    }

    // ── Clear all ─────────────────────────────────────
    function clearAll() {
        dataInput.value = '';
        hourlyRateInput.value = '';
        resultDiv.innerHTML = '';
        summaryDiv.innerHTML = '';
        recalcDiv.innerHTML = '';
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
