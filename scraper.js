const { chromium } = require('playwright');

async function scrapeTimesheet(username, password) {
    let browser;
    try {
        browser = await chromium.launch({ 
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage', 
                '--disable-gpu',
                '--no-zygote',
                '--single-process'
            ]
        });
        const context = await browser.newContext();
        const page = await context.newPage();

        // Tối ưu tốc độ: Chặn tải hình ảnh, fonts, và tracking (KHÔNG chặn CSS vì Blazor WASM cần nó để render)
        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (['image', 'font', 'media'].includes(type) || route.request().url().includes('google-analytics')) {
                route.abort();
            } else {
                route.continue();
            }
        });

        console.log('Navigating to KFC HR...');
        await page.goto('https://hr.kfcvietnam.com.vn/', { waitUntil: 'networkidle', timeout: 60000 });

        // Wait for Blazor to complete its initial render and the login form to show
        console.log('Waiting for login form...');
        await page.waitForSelector('input[type="text"]', { timeout: 60000 });
        
        const inputs = await page.$$('input');
        let userField, passField;

        for (const input of inputs) {
            const type = await input.getAttribute('type');
            if (type === 'text' && !userField) userField = input;
            if (type === 'password' && !passField) passField = input;
        }

        if (!userField || !passField) {
            throw new Error("Không tìm thấy trường nhập Mã Nhân Viên hoặc Mật khẩu");
        }

        console.log('Filling credentials...');
        await userField.fill(username);
        await passField.fill(password);

        console.log('Clicking login...');
        const loginBtn = await page.$('button[type="submit"], button:has-text("Đăng nhập"), button:has-text("Login")');
        if (loginBtn) {
            await loginBtn.click();
        } else {
            await passField.press('Enter');
        }

        console.log('Waiting for successful login / Dashboard...');
        // Match generic text that appears on the dashboard or navbar
        await page.waitForFunction(() => {
            return document.body.innerText.includes('Bảng công') || 
                   document.body.innerText.includes('Bảng Công') || 
                   document.body.innerText.includes('Timesheet');
        }, { timeout: 25000 });

        console.log('Navigating to Timesheet page...');
        // Find and click the explicit menu item for timesheet
        const menuBtn = await page.$('.menu-item:has-text("Bảng công"), .menu-item:has-text("Timesheet")');
        if (menuBtn) {
            await menuBtn.click();
        } else {
            throw new Error("Sang trang Dashboard nhưng không tìm thấy nút menu 'Bảng công'");
        }

        // Wait for the timesheet table. Blazor replaces DOM elements, so wait for a table to appear inside the main app.
        console.log('Waiting for timesheet data to load...');
        try {
            // Check for the specific timesheet row class instead of table tag
            await page.waitForSelector('.timesheet-row', { timeout: 15000 });
        } catch (e) {
            console.log('Timesheet rows not found within 15s. Taking debug snapshot...');
            await page.screenshot({ path: 'debug.png', fullPage: true });
            const html = await page.content();
            const fs = require('fs');
            fs.writeFileSync('debug.html', html);
            throw new Error(`Không thấy dữ liệu bảng công. Đã lưu ảnh màn hình hiện trường vào file 'debug.png'.`);
        }
        await page.waitForTimeout(500); // Wait 500ms for bindings to render properly

        console.log('Extracting data...');
        const result = await page.evaluate(() => {
            // Lấy tên nhân viên
            const nameEl = document.querySelector('.user-info .user-name');
            const employeeName = nameEl ? nameEl.innerText.trim() : 'Không rõ tên';

            // Hệ thống KFC dùng thẻ DIV thay vì TABLE.
            const rows = document.querySelectorAll('.timesheet-row');
            let output = '';
            
            rows.forEach(row => {
                const cells = row.querySelectorAll('.shift-type, .shift-time, .shift-hour');
                if (cells.length > 0) {
                    const rowText = Array.from(cells).map(cell => cell.innerText.trim()).join('\t');
                    output += rowText + '\n';
                }
            });
            return { tableData: output, employeeName };
        });

        await browser.close();

        if (!result.tableData || result.tableData.trim() === '') {
            throw new Error("Bảng công được hiển thị nhưng trống hoặc không có dữ liệu giờ làm");
        }

        console.log('Scraping finished successfully for ' + result.employeeName);
        return result;

    } catch (error) {
        if (browser) await browser.close();
        console.error("Playwright automation failed:", error.message);
        throw new Error("Bot Error: " + error.message);
    }
}

module.exports = { scrapeTimesheet };
