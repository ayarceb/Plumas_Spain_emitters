async function loadCSV() {
    const response = await fetch("../data/locations.csv");
    const text = await response.text();
    const rows = text.trim().split("\n").slice(1);

    return rows.map(r => {
        const [id, name, lat, lon, type, annual] = r.split(",");
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

function windField(angle) {
    // Convert compass degrees (0° = norte, 90° = este) a radianes
    const rad = (angle + 90) * Math.PI / 180;
    return { ux: Math.cos(rad), uy: Math.sin(rad) };
}

async function main() {
    const maptilerKey = (window.MAPTILER_KEY || "").trim();
    const hasMaptilerKey = maptilerKey && maptilerKey !== "get_your_own_D6rA4zTHduk6KOKTXzGB";
    const styleUrl = hasMaptilerKey
        ? `https://api.maptiler.com/maps/topo-v2/style.json?key=${maptilerKey}`
        : "https://demotiles.maplibre.org/style.json";

    const map = new maplibregl.Map({
        container: "map",
        style: styleUrl,
        projection: "globe",
        center: [-3.7, 40.3],
        zoom: 4,
        pitch: 45,
        bearing: 0
    });

    await new Promise(r => map.on("load", r));

    if (hasMaptilerKey) {
        map.addSource("terrain-dem", {
            type: "raster-dem",
            url: `https://api.maptiler.com/tiles/terrain-rgb/tiles.json?key=${maptilerKey}`,
            tileSize: 512,
            maxzoom: 14
        });
        map.setTerrain({ source: "terrain-dem", exaggeration: 1.2 });
    }

    const sites = await loadCSV();

    map.addSource("plants", {
        type: "geojson",
        data: {
            type: "FeatureCollection",
            features: sites.map(s => ({
                type: "Feature",
                geometry: { type: "Point", coordinates: [s.lon, s.lat] },
                properties: s
            }))
        }
    });

    map.addLayer({
        id: "plants-layer",
        type: "circle",
        source: "plants",
        paint: {
            "circle-radius": 1.8,
            "circle-color": "#ff5533",
            "circle-stroke-width": 0.6,
            "circle-stroke-color": "#000"
        }
    });

    // Particle system
    const particles = [];
    const N = 150;
    const dispersion = 0.04;
    const speed = 0.035;
    const life = 90;

    sites.forEach(s => {
        for (let i = 0; i < N; i++) {
            particles.push({
                lat: s.lat,
                lon: s.lon,
                baseLat: s.lat,
                baseLon: s.lon,
                age: Math.random() * life
            });
        }
    });

    let windDeg = 90;

    function realignParticles() {
        const w = windField(windDeg);

        particles.forEach(p => {
            // Conserva la edad para que la emisión siga siendo continua y
            // recoloca cada partícula en la nueva dirección, añadiendo una
            // ligera desviación lateral.
            const lateral = (Math.random() - 0.5) * dispersion * p.age * 0.2;
            const perpX = -w.uy;
            const perpY = w.ux;

            p.lat = p.baseLat + w.uy * speed * p.age + perpY * lateral;
            p.lon = p.baseLon + w.ux * speed * p.age + perpX * lateral;
        });
    }

    const windValueEl = document.getElementById("windValue");
    windValueEl.innerText = windDeg + "°";

    document.getElementById("windAngle").addEventListener("input", e => {
        windDeg = parseInt(e.target.value);
        windValueEl.innerText = windDeg + "°";
        realignParticles();
    });

    // Prebuild plume features so we can reuse the same objects and avoid per-frame allocations.
    const plumeFeatures = particles.map(p => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] }
    }));

    const plumeGeoJSON = {
        type: "FeatureCollection",
        features: plumeFeatures
    };

    map.addSource("plumes", {
        type: "geojson",
        data: plumeGeoJSON
    });

    map.addLayer({
        id: "plumes-layer",
        type: "circle",
        source: "plumes",
        paint: {
            "circle-radius": 2,
            "circle-color": "rgba(255, 128, 0, 0.78)"
        }
    });

    function stepParticles() {
        const w = windField(windDeg);
        particles.forEach(p => {
            p.lat += w.uy * speed + (Math.random() - 0.5) * dispersion;
            p.lon += w.ux * speed + (Math.random() - 0.5) * dispersion;

            p.age++;
            if (p.age > life) {
                p.age = 0;
                p.lat = p.baseLat;
                p.lon = p.baseLon;
            }
        });
    }

    function updatePlumes() {
        for (let i = 0; i < particles.length; i++) {
            plumeFeatures[i].geometry.coordinates[0] = particles[i].lon;
            plumeFeatures[i].geometry.coordinates[1] = particles[i].lat;
        }
        map.getSource("plumes").setData(plumeGeoJSON);
    }

    let lastUpdate = 0;
    const updateInterval = 40; // ~25fps to reduce load while keeping motion smooth

    function animate(timestamp = 0) {
        stepParticles();
        if (timestamp - lastUpdate >= updateInterval) {
            updatePlumes();
            lastUpdate = timestamp;
        }
        requestAnimationFrame(animate);
    }

    animate();
}

main();
