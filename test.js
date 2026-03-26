const raw = `01
CN
W
10:00
14:00
18:00
22:00
8.00
0.00
0.00
0.00
1.00
Đã duyệt
Pass
Parttime - PA1
Crew
083-HNYP
Lobby`;

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

console.log(parseEntries(raw));
