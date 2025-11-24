async function loadCSV() {
    const response = await fetch('../data/locations.csv');
    const text = await response.text();
    const rows = text.trim().split('\n').slice(1);

    return rows.map(r => {
        const [id, name, lat, lon, type, annual] = r.split(',');
        return {
            id,
            name,
            lat: parseFloat(lat),
            lon: parseFloat(lon),
            type,
            annual: parseFloat(annual)
        };
    });
}

function windVector(lat, lon, angleDeg) {
    const angle = angleDeg * Math.PI / 180;

    const dx = Math.cos(angle) * 0.4;
    const dy = Math.sin(angle) * 0.4;

    return [[lat, lon], [lat + dy, lon + dx]];
}

async function main() {
    const map = L.map('map').setView([40.3, -3.7], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
      .addTo(map);

    const entries = await loadCSV();

    let windAngle = 90;
    let windLayers = [];

    function drawWind() {
        windLayers.forEach(l => map.removeLayer(l));
        windLayers = [];

        entries.forEach(p => {
            const seg = windVector(p.lat, p.lon, windAngle);
            const line = L.polyline(seg, { color: '#0080ff', weight: 3 });
            line.addTo(map);
            windLayers.push(line);
        });
    }

    entries.forEach(p => {
        L.circleMarker([p.lat, p.lon], {
            radius: 7,
            color: '#ff5733',
            weight: 2,
            fillOpacity: 0.7
        }).addTo(map)
        .bindPopup(`
            <strong>${p.name}</strong><br>
            Tipo: ${p.type}<br>
            Emisión estimada: ${p.annual} kt/a
        `);
    });

    drawWind();

    document.getElementById('windAngle').addEventListener('input', e => {
        windAngle = parseInt(e.target.value);
        document.getElementById('windValue').innerText = windAngle + '°';
        drawWind();
    });
}

main();
