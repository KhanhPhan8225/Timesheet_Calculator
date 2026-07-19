import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { scrapeTimesheet } from './scraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: ['https://kfc.khanhphandev.id.vn', 'http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// Serve static files from root directory
app.use(express.static(path.join(__dirname)));

app.post('/api/timesheet', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Missing username or password' });
    }

    try {
        const result = await scrapeTimesheet(username, password);
        res.json({ success: true, data: result.tableData, employeeName: result.employeeName });
    } catch (error) {
        console.error('Error scraping:', error);
        res.status(500).json({ error: error.message || 'Scraping failed' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);

    // Start Telegram Bot (optional — only if TELEGRAM_BOT_TOKEN is set)
    import('./telegram-bot.js').catch(err => {
        if (err.message !== 'TELEGRAM_BOT_DISABLED') {
            console.error('Failed to start Telegram Bot:', err.message);
        }
    });
});
