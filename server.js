require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { scrapeTimesheet } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
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
});
