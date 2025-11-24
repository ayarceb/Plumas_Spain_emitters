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
    const rad = angle * Math.PI / 180;
    return { ux: Math.cos(rad), uy: Math.sin(rad) };
}

async function main() {
    const map = new maplibregl.Map({
        container: "map",
        style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
        projection: "globe",
        center: [-3.7, 40.3],
        zoom: 4,
        pitch: 45,
        bearing: 0
    });

    // globo real
    map.setProjection({ name: "globe" });
    map.setTerrain({});

    // controles de zoom
    map.addControl(
        new maplibregl.NavigationControl({
            showCompass: true,
            showZoom: true
        }),
        "top-right"
    );

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
            "circle-radius": 3,
            "circle-color": "#ff5533",
            "circle-stroke-width": 1,
            "circle-stroke-color": "#000"
        }
    });

    // Particle system
    const particles = [];
    const N = 100;
    const dispersion = 0.04;
    const speed = 0.035;
    const life = 50;

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
    document.getElementById("windAngle").addEventListener("input", e => {
        windDeg = parseInt(e.target.value);
        document.getElementById("windValue").innerText = windDeg + "°";
    });

    map.addSource("plumes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
    });

    map.addLayer({
        id: "plumes-layer",
        type: "circle",
        source: "plumes",
        paint: {
            "circle-radius": 2,
            "circle-color": "rgba(0,150,255,0.5)"
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
        map.getSource("plumes").setData({
            type: "FeatureCollection",
            features: particles.map(p => ({
                type: "Feature",
                geometry: { type: "Point", coordinates: [p.lon, p.lat] }
            }))
        });
    }

    function animate() {
        stepParticles();
        updatePlumes();
        requestAnimationFrame(animate);
    }

    animate();
}

main();
