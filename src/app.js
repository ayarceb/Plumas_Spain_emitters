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

const era5Series = [
    { deg: 290, speed: 0.82 },
    { deg: 286, speed: 0.88 },
    { deg: 282, speed: 0.94 },
    { deg: 276, speed: 1.05 },
    { deg: 268, speed: 1.14 },
    { deg: 258, speed: 1.22 },
    { deg: 247, speed: 1.18 },
    { deg: 238, speed: 1.07 },
    { deg: 230, speed: 0.97 },
    { deg: 225, speed: 0.9 },
    { deg: 222, speed: 0.86 },
    { deg: 224, speed: 0.91 },
    { deg: 228, speed: 0.99 },
    { deg: 238, speed: 1.12 },
    { deg: 251, speed: 1.23 },
    { deg: 265, speed: 1.28 },
    { deg: 276, speed: 1.21 },
    { deg: 284, speed: 1.08 },
    { deg: 289, speed: 0.95 },
    { deg: 293, speed: 0.88 },
    { deg: 295, speed: 0.84 },
    { deg: 295, speed: 0.82 },
    { deg: 294, speed: 0.81 },
    { deg: 292, speed: 0.82 }
];

function interpolateBearing(a, b, t) {
    const diff = (((b - a + 540) % 360) - 180);
    return (a + diff * t + 360) % 360;
}

const windPatterns = {
    manual: () => null,
    seaBreeze: t => {
        // Oscilación suave inspirada en brisa marina con más intensidad a mediodía
        const swing = 25 * Math.sin(t / 40);
        const deg = 110 + swing;
        const diurnal = Math.max(0, Math.sin(t / 55));
        const speed = 0.9 + 0.25 * diurnal;
        return { deg, speed };
    },
    rotatingFront: t => {
        const deg = (t * 10) % 360;
        const speed = 1.1 + 0.15 * Math.sin(t / 20);
        return { deg, speed };
    },
    gustyWesterlies: t => {
        const deg = 270 + 8 * Math.sin(t / 18) + 18 * Math.sin(t / 46);
        const speed = 1 + 0.35 * Math.max(0, Math.sin(t / 14));
        return { deg, speed };
    },
    era5Sample: t => {
        // Aproximación de un ciclo diario usando direcciones y velocidades
        // suavizadas a partir de valores horarios de ERA5 (campo realista sin API).
        const n = era5Series.length;
        const virtualHour = (t / 30) % n; // recorre las 24 muestras en ~12 min
        const i0 = Math.floor(virtualHour);
        const i1 = (i0 + 1) % n;
        const frac = virtualHour - i0;
        const seg0 = era5Series[i0];
        const seg1 = era5Series[i1];

        const deg = interpolateBearing(seg0.deg, seg1.deg, frac);
        const speed = seg0.speed + (seg1.speed - seg0.speed) * frac;
        return { deg, speed };
    }
};

async function main() {
    // Allow MapTiler topo+terrain if a key is available; otherwise fall back to
    // a keyless OpenTopoMap raster style so the map always loads.
    const hasMaptilerKey = typeof window !== "undefined" && Boolean(window.MAPTILER_KEY);

    const map = new maplibregl.Map({
        container: "map",
        style: hasMaptilerKey
            ? `https://api.maptiler.com/maps/topo-v2/style.json?key=${window.MAPTILER_KEY}`
            : {
                  version: 8,
                  name: "OpenTopoMap",
                  sources: {
                      opentopo: {
                          type: "raster",
                          tiles: [
                              "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
                              "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
                              "https://c.tile.opentopomap.org/{z}/{x}/{y}.png"
                          ],
                          tileSize: 256,
                          attribution:
                              "© OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors"
                      }
                  },
                  layers: [
                      {
                          id: "opentopo",
                          type: "raster",
                          source: "opentopo",
                          minzoom: 0,
                          maxzoom: 17
                      }
                  ]
              },
        projection: "globe",
        center: [-3.7, 40.3],
        zoom: 4,
        pitch: 45,
        bearing: 0
    });

    await new Promise(r => map.on("load", r));

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
    const baseSpeed = 0.035;
    const life = 140;

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
    let speedFactor = 1;

    function realignParticles() {
        const w = windField(windDeg);

        particles.forEach(p => {
            // Conserva la edad para que la emisión siga siendo continua y
            // recoloca cada partícula en la nueva dirección, añadiendo una
            // ligera desviación lateral.
            const lateral = (Math.random() - 0.5) * dispersion * p.age * 0.2;
            const perpX = -w.uy;
            const perpY = w.ux;

            p.lat = p.baseLat + w.uy * baseSpeed * speedFactor * p.age + perpY * lateral;
            p.lon = p.baseLon + w.ux * baseSpeed * speedFactor * p.age + perpX * lateral;
        });
    }

    const windValueEl = document.getElementById("windValue");
    const windSlider = document.getElementById("windAngle");
    const windPattern = document.getElementById("windPattern");

    function updateWindLabel() {
        windValueEl.innerText = `${Math.round(windDeg)}° · ×${speedFactor.toFixed(2)}`;
    }

    function setWind(deg, { speed, realign } = {}) {
        windDeg = deg;
        if (typeof speed === "number") {
            speedFactor = speed;
        }
        windSlider.value = Math.round(deg % 360);
        updateWindLabel();
        if (realign) {
            realignParticles();
        }
    }

    setWind(windDeg);

    windSlider.addEventListener("input", e => {
        if (windPattern.value !== "manual") {
            windPattern.value = "manual";
            windSlider.disabled = false;
        }
        setWind(parseInt(e.target.value, 10), { realign: true });
    });

    windPattern.addEventListener("change", () => {
        const selected = windPattern.value;
        windSlider.disabled = selected !== "manual";
        if (selected === "manual") {
            setWind(parseInt(windSlider.value, 10), { speed: 1, realign: true });
            return;
        }
        const now = performance.now() / 1000;
        const pattern = windPatterns[selected];
        const next = pattern ? pattern(now) : null;
        if (next) {
            setWind(next.deg, { speed: next.speed, realign: true });
        }
    });

    // Prebuild plume features so we can reuse the same objects and avoid per-frame allocations.
    const plumeFeatures = particles.map(p => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: { age: p.age }
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
            "circle-color": "rgba(255, 128, 0, 0.78)",
            "circle-opacity": [
                "interpolate",
                ["linear"],
                ["get", "age"],
                0,
                0.95,
                life,
                0
            ],
            "circle-blur": 0.15
        }
    });

    function stepParticles() {
        const w = windField(windDeg);
        particles.forEach(p => {
            p.lat += w.uy * baseSpeed * speedFactor + (Math.random() - 0.5) * dispersion;
            p.lon += w.ux * baseSpeed * speedFactor + (Math.random() - 0.5) * dispersion;

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
            plumeFeatures[i].properties.age = particles[i].age;
        }
        map.getSource("plumes").setData(plumeGeoJSON);
    }

    let lastUpdate = 0;
    const updateInterval = 40; // ~25fps to reduce load while keeping motion smooth

    function animate(timestamp = 0) {
        const pattern = windPatterns[windPattern.value];
        if (pattern && windPattern.value !== "manual") {
            const t = timestamp / 1000;
            const next = pattern(t);
            if (next) {
                setWind(next.deg, { speed: next.speed });
            }
        }
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
