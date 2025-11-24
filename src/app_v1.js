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

function windField(angleDeg) {
    const ang = angleDeg * Math.PI / 180;
    return {
        ux: Math.cos(ang),
        uy: Math.sin(ang)
    };
}

async function main() {
    const map = L.map('map').setView([40.3, -3.7], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
        .addTo(map);

    const sources = await loadCSV();

    sources.forEach(p => {
        L.circleMarker([p.lat, p.lon], {
            radius: 5,
            color: '#ff5733',
            weight: 2,
            fillOpacity: 0.8
        })
            .addTo(map)
            .bindPopup(`
                <strong>${p.name}</strong><br>
                Tipo: ${p.type}<br>
                Emisión estimada: ${p.annual} kt/a
            `);
    });

    //-------------------------------------------------------
    // PARTICLES INITIALIZATION
    //-------------------------------------------------------

    const particles = [];
    const N = 140;         // particles per source
    const dispersion = 0.003;
    const speed = 0.002;
    const life = 200;

    function initParticles() {
        particles.length = 0;
        sources.forEach(p => {
            for (let i = 0; i < N; i++) {
                particles.push({
                    lat: p.lat,
                    lon: p.lon,
                    baseLat: p.lat,
                    baseLon: p.lon,
                    age: Math.random() * life
                });
            }
        });
    }

    initParticles();

    //-------------------------------------------------------
    // WIND CONTROL
    //-------------------------------------------------------

    let angleWind = 90;

    document.getElementById('windAngle').addEventListener('input', e => {
        angleWind = parseInt(e.target.value);
        document.getElementById('windValue').innerText = angleWind + '°';
    });

    //-------------------------------------------------------
    // PARTICLES UPDATE
    //-------------------------------------------------------

    function advect() {
        const w = windField(angleWind);

        particles.forEach(pt => {
            pt.lat += w.uy * speed + (Math.random() - 0.5) * dispersion;
            pt.lon += w.ux * speed + (Math.random() - 0.5) * dispersion;

            pt.age += 1;

            if (pt.age > life) {
                pt.age = 0;
                pt.lat = pt.baseLat;
                pt.lon = pt.baseLon;
            }
        });
    }

    //-------------------------------------------------------
    // CANVAS LAYER
    //-------------------------------------------------------

    const canvasLayer = L.canvasLayer().delegate({
        drawLayer: function (info) {
            const ctx = info.ctx;
            const mapInstance = info.map;

            ctx.clearRect(0, 0, info.canvas.width, info.canvas.height);
            ctx.fillStyle = 'rgba(0, 120, 255, 0.35)';

            particles.forEach(pt => {
                const p = mapInstance.latLngToContainerPoint([pt.lat, pt.lon]);
                ctx.beginPath();
                ctx.arc(p.x, p.y, 1.6, 0, 2 * Math.PI);
                ctx.fill();
            });
        }
    }).addTo(map);

    //-------------------------------------------------------
    // ANIMATION LOOP
    //-------------------------------------------------------

    function frame() {
        advect();
        canvasLayer._redraw();
        requestAnimationFrame(frame);
    }

    frame();
}

main();
