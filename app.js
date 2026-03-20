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

    // ── Parsing (returns entries with day info) ──────
    function parseEntries(raw) {
        const lines = raw.split('\n').filter((l) => l.trim());
        const entries = [];
        const hourPattern = /\b\d+[.,]\d{1,2}\b/g;
        const dayInfoPattern = /^(\d{1,2})\t(CN|T[2-7])\t/;

        lines.forEach((line) => {
            const normalized = line.replace(/,/g, '.');
            const matches = normalized.match(hourPattern);
            if (!matches) return;

            const validHours = [];
            matches.forEach((m) => {
                const num = parseFloat(m);
                if (num > 0 && num <= 24) validHours.push(num);
            });

            if (validHours.length === 0) return;

            // Extract day info from line
            const dayMatch = line.match(dayInfoPattern);
            const dayNum = dayMatch ? dayMatch[1].padStart(2, '0') : null;
            const dayName = dayMatch ? dayMatch[2] : null;

            entries.push({
                day: dayNum,
                dayName: dayName,
                hours: validHours[validHours.length - 1], // last valid decimal is usually the hours column
                label: dayName ? `${dayName} ${dayNum}` : null,
            });
        });

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
    function buildSalaryHTML(total, hourlyRate, entryCount) {
        if (hourlyRate <= 0) return '';

        const gross = total * hourlyRate;
        const avgPerDay = gross / entryCount;

        return `
            <div class="salary-card">
                <h2 class="salary-title">💵 LƯƠNG DỰ KIẾN (THAM KHẢO)</h2>
                <div class="salary-detail">
                    <strong>${total.toFixed(2)} giờ × ${formatMoney(hourlyRate).replace(' VNĐ', '')} VNĐ/giờ</strong>
                </div>
                <div class="salary-total">🎯 Tổng lương: ${formatMoney(gross)}</div>
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
                return `${label}: ${e.hours} giờ`;
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

            const total = entries.reduce((sum, e) => sum + e.hours, 0);
            const chartHTML = buildChartHTML(entries);
            const salaryHTML = buildSalaryHTML(total, hourlyRate, entries.length);

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
            '08\tCN\tW\t16:30\t\t22:00\t5.50\t-\t-\t-\tĐã duyệt',
            '09\tT2\tW\t17:00\t\t22:00\t5.00\t-\t-\t-\tĐã duyệt',
            '10\tT3\tW\t17:30\t\t22:30\t5.00\t-\t-\t-\tĐã duyệt',
            '11\tT4\tW\t17:00\t\t22:30\t5.50\t-\t-\t-\tĐã duyệt',
            '12\tT5\tW\t17:00\t\t22:00\t5.00\t-\t-\t-\tĐã duyệt',
            '13\tT6\tW\t13:00\t\t22:30\t9.50\t-\t-\t-\tĐã duyệt',
            '21\tT7\tW\t16:00\t\t22:00\t6.00\t-\t-\t-\tĐã duyệt',
            '22\tCN\tW\t10:00\t\t14:00\t4.00\t-\t-\t-\tĐã duyệt',
            '23\tT2\tW\t10:15\t15:00\t18:00\t22:00\t8.75\t-\t-\t-\tĐã duyệt',
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
