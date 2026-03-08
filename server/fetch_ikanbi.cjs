const https = require('https');

https.get('https://www.ikanbi.com', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const hexRegex = /#[a-fA-F0-9]{6}\b/g;
        const matches = data.match(hexRegex);
        if (!matches) {
            console.log("No colors found.");
            return;
        }
        const colorCounts = {};
        matches.forEach(color => {
            const lower = color.toLowerCase();
            colorCounts[lower] = (colorCounts[lower] || 0) + 1;
        });

        // Sort by count descending
        const sorted = Object.entries(colorCounts).sort((a, b) => b[1] - a[1]);
        console.log("Top colors found on ikanbi.com:");
        sorted.slice(0, 15).forEach(([color, count]) => {
            console.log(`${color}: ${count} times`);
        });
    });
}).on('error', err => {
    console.error("Error fetching: ", err.message);
});
