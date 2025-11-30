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

async function loadEmissionSeriesForSite(siteId) {
    const candidates = [
        // Repo root (when serving from src/)
        `../CSV_2021_TOP/${siteId}_NO2_timeseries_2km_Ktyear.csv`,
        `./CSV_2021_TOP/${siteId}_NO2_timeseries_2km_Ktyear.csv`,
        `/CSV_2021_TOP/${siteId}_NO2_timeseries_2km_Ktyear.csv`,
        // data/ subfolder (if CSV_2021_TOP is kept next to locations.csv)
        `../data/CSV_2021_TOP/${siteId}_NO2_timeseries_2km_Ktyear.csv`,
        `./data/CSV_2021_TOP/${siteId}_NO2_timeseries_2km_Ktyear.csv`,
        `/data/CSV_2021_TOP/${siteId}_NO2_timeseries_2km_Ktyear.csv`
    ];

    for (const url of candidates) {
        try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const text = await res.text();
            const lines = text
                .split(/\r?\n/)
                .map(l => l.trim())
                .filter(Boolean);

            if (!lines.length) continue;

            const dataRows = lines[0].toLowerCase().includes("no2") ? lines.slice(1) : lines;
            const values = [];
            const times = [];

            for (const row of dataRows) {
                const parts = row.split(/[;,\t ]+/);
                if (parts.length < 2) continue;
                const timeStr = parts[0];
                const val = parseFloat(parts[1]);
                if (Number.isNaN(val)) continue;
                const parsedTime = Date.parse(timeStr);
                if (!Number.isNaN(parsedTime)) times.push(parsedTime);
                values.push(val);
            }

            if (!values.length) continue;

            const min = Math.min(...values);
            const max = Math.max(...values);
            const span = max - min;
            const normalized = values.map(v => {
                if (!span) return 1;
                const scaled = (v - min) / span;
                return 0.25 + scaled * 0.75; // evita que caiga a cero
            });

            const loopSeconds = 120;
            const stepSeconds = Math.max(2.5, loopSeconds / normalized.length);

            return { normalized, values, min, max, stepSeconds, times, sourcePath: res.url };
        } catch (err) {
            console.warn(`No se pudo cargar ${url}:`, err);
        }
    }

    return null;
}

async function loadEmissionSeriesForSites(sites, statusEl) {
    if (statusEl) statusEl.textContent = "Cargando emisiones…";

    const foundPaths = new Set();
    const entries = await Promise.all(
        sites.map(async site => {
            const series = await loadEmissionSeriesForSite(site.id);
            if (series && series.sourcePath) {
                foundPaths.add(series.sourcePath.replace(window.location.origin, ""));
            }
            return { id: site.id, series };
        })
    );

    const result = new Map();
    let found = 0;
    entries.forEach(entry => {
        if (entry.series) {
            result.set(entry.id, entry.series);
            found++;
        }
    });

    if (statusEl) {
        if (found) {
            const paths = Array.from(foundPaths);
            const hint = paths.length ? ` desde ${paths.join(", ")}` : "";
            statusEl.textContent = `Emisiones dinámicas cargadas (${found}/${sites.length})${hint}`;
        } else {
            statusEl.textContent = "Emisiones dinámicas no encontradas (se usa anual). Coloca CSV_2021_TOP/ junto a data/ o en la raíz.";
        }
    }

    return result;
}

function windField(angle) {
    // Convert compass degrees (0° = norte, 90° = este) a radianes
    const rad = (angle + 90) * Math.PI / 180;
    return { ux: Math.cos(rad), uy: Math.sin(rad) };
}

function bearingFromUV(u, v) {
    // Invert the windField conversion: vector -> brújula (0° = norte)
    const rad = Math.atan2(v, u);
    return (rad * 180 / Math.PI - 90 + 360) % 360;
}

function findVariable(reader, candidates) {
    const lc = name => name.toLowerCase();
    const vars = reader.variables.map(v => v.name);
    return candidates.find(c => vars.some(v => lc(v) === c || lc(v).includes(c)));
}

function getDimSize(reader, name) {
    const dim = reader.dimensions.find(d => d.name === name);
    return dim ? dim.size : null;
}

function nearestLevelIndex(reader, levelDimName) {
    const levelVar = reader.variables.find(v => v.name === levelDimName);
    if (!levelVar) return 0;
    const data = reader.getDataVariable(levelDimName);
    if (!data || !data.length) return 0;
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < data.length; i++) {
        const diff = Math.abs(data[i] - 1);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestIdx = i;
        }
    }
    return bestIdx;
}

function computeOffset(indices, sizes) {
    let offset = 0;
    for (let i = 0; i < sizes.length; i++) {
        offset = offset * sizes[i] + indices[i];
    }
    return offset;
}

function averageUVAtTime(reader, uVar, vVar, timeIdx, levelIdx) {
    const dimMap = Object.fromEntries(reader.dimensions.map(d => [d.name, d.size]));
    const dims = uVar.dimensions;
    const sizes = dims.map(name => dimMap[name]);
    const timeAxis = dims.findIndex(d => /time/i.test(d));
    const levelAxis = dims.findIndex(d => /lev/i.test(d) || /isob/i.test(d) || /hgt/i.test(d));

    const idx = new Array(sizes.length).fill(0);
    if (timeAxis >= 0) {
        idx[timeAxis] = timeIdx;
    }
    if (levelAxis >= 0 && typeof levelIdx === "number") {
        idx[levelAxis] = levelIdx;
    }

    const uData = reader.getDataVariable(uVar.name);
    const vData = reader.getDataVariable(vVar.name);

    let sumU = 0;
    let sumV = 0;
    let count = 0;

    function walk(dim) {
        if (dim === sizes.length) {
            const off = computeOffset(idx, sizes);
            sumU += uData[off];
            sumV += vData[off];
            count++;
            return;
        }
        if (dim === timeAxis || dim === levelAxis) {
            walk(dim + 1);
            return;
        }
        for (let i = 0; i < sizes[dim]; i++) {
            idx[dim] = i;
            walk(dim + 1);
        }
    }

    walk(0);
    return count ? { u: sumU / count, v: sumV / count } : { u: 0, v: 0 };
}

function getNetcdfReaderCtor() {
    if (typeof netcdfjs !== "undefined") {
        if (typeof netcdfjs.NetCDFReader === "function") return netcdfjs.NetCDFReader;
        if (typeof netcdfjs === "function") return netcdfjs;
    }
    if (typeof window !== "undefined" && typeof window.NetCDFReader === "function") {
        return window.NetCDFReader;
    }
    return null;
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
        document.head.appendChild(script);
    });
}

async function ensureNetcdfReader(statusEl) {
    let NetcdfReader = getNetcdfReaderCtor();
    if (NetcdfReader) return NetcdfReader;

    const fallbackUrls = [
        "./lib/netcdfjs.min.js",
        "https://cdn.jsdelivr.net/npm/netcdfjs@1.1.0/dist/netcdfjs.min.js",
        "https://unpkg.com/netcdfjs@1.1.0/dist/netcdfjs.min.js",
        "https://raw.githubusercontent.com/cheminfo/netcdfjs/master/dist/netcdfjs.min.js"
    ];

    for (const url of fallbackUrls) {
        try {
            if (statusEl) statusEl.textContent = `Cargando netcdfjs… (${url})`;
            await loadScript(url);
            NetcdfReader = getNetcdfReaderCtor();
            if (NetcdfReader) {
                if (statusEl) statusEl.textContent = "netcdfjs listo";
                return NetcdfReader;
            }
        } catch (err) {
            console.warn(`No se pudo cargar ${url}:`, err);
        }
    }

    if (statusEl) {
        statusEl.textContent = "netcdfjs no disponible (añade lib/netcdfjs.min.js)";
    }
    return null;
}

async function loadNetcdfWindSeries(statusEl) {
    const NetcdfReader = await ensureNetcdfReader(statusEl);
    if (!NetcdfReader) {
        console.info("Serie NetCDF omitida: faltó netcdfjs (añádelo en src/lib/ o habilita Internet/CDN).");
        return null;
    }

    // Try multiple relative paths so the dataset is found whether the page is served
    // from /src, the repo root, or a bundled output directory.
    const netcdfCandidates = [
        "../data/SAUPUNTA_ERA5-lvl-20210101t1300.nc",
        "./data/SAUPUNTA_ERA5-lvl-20210101t1300.nc",
        "/data/SAUPUNTA_ERA5-lvl-20210101t1300.nc"
    ];

    let buffer = null;
    let netcdfPath = null;

    try {
        for (const candidate of netcdfCandidates) {
            const response = await fetch(candidate);
            if (!response.ok) {
                console.warn(`NetCDF no encontrado en ${candidate} (${response.status}).`);
                continue;
            }
            buffer = await response.arrayBuffer();
            netcdfPath = candidate;
            break;
        }

        if (!buffer) {
            const msg = "NetCDF no disponible en data/ (añade SAUPUNTA_ERA5-lvl-20210101t1300.nc)";
            if (statusEl) statusEl.textContent = msg;
            throw new Error("NetCDF file missing in /data paths");
        }

        if (statusEl && netcdfPath) {
            statusEl.textContent = `NetCDF listo (${netcdfPath})`;
        }

        const reader = new NetcdfReader(new DataView(buffer));

        const uName = findVariable(reader, ["u", "u10", "u_component"]); // prefer plain u/v first
        const vName = findVariable(reader, ["v", "v10", "v_component"]);
        if (!uName || !vName) {
            console.warn("No se encontraron variables u/v en el NetCDF.");
            return null;
        }

        const uVar = reader.variables.find(v => v.name === uName);
        const vVar = reader.variables.find(v => v.name === vName);
        const timeDim = (uVar.dimensions || []).find(d => /time/i.test(d));
        const timeLen = timeDim ? getDimSize(reader, timeDim) : 1;
        const levelDim = (uVar.dimensions || []).find(d => /lev/i.test(d) || /isob/i.test(d) || /hgt/i.test(d));
        const levelIdx = levelDim ? nearestLevelIndex(reader, levelDim) : null;

        const series = [];
        for (let t = 0; t < timeLen; t++) {
            const { u, v } = averageUVAtTime(reader, uVar, vVar, t, levelIdx);
            const speed = Math.sqrt(u * u + v * v);
            const deg = bearingFromUV(u, v);
            series.push({ deg, speed });
        }

        const avgSpeed = series.reduce((acc, s) => acc + s.speed, 0) / Math.max(1, series.length);
        const normalized = series.map(s => ({
            deg: s.deg,
            speed: Math.max(0.1, s.speed / (avgSpeed || 1))
        }));

        return normalized;
    } catch (err) {
        console.warn("No se pudo cargar el viento NetCDF:", err);
        return null;
    }
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

const netcdfStatusEl = typeof document !== "undefined" ? document.getElementById("netcdfStatus") : null;
const netcdfSeriesPromise = loadNetcdfWindSeries(netcdfStatusEl);
const emissionStatusEl = typeof document !== "undefined" ? document.getElementById("emissionStatus") : null;

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
                  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
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
    let emissionSeriesById = new Map();
    const emissionSeriesPromise = loadEmissionSeriesForSites(sites, emissionStatusEl);
    emissionSeriesPromise.then(seriesMap => {
        emissionSeriesById = seriesMap || new Map();
    });

    const plantsGeoJSON = {
        type: "FeatureCollection",
        features: sites.map(s => ({
            type: "Feature",
            id: s.id,
            geometry: { type: "Point", coordinates: [s.lon, s.lat] },
            properties: { ...s, emissionText: "…" }
        }))
    };

    map.addSource("plants", {
        type: "geojson",
        data: plantsGeoJSON
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

    map.addLayer({
        id: "plant-emissions",
        type: "symbol",
        source: "plants",
        layout: {
            "text-field": ["coalesce", ["get", "emissionText"], "…"],
            "text-size": 12,
            "text-offset": [0, 1.2],
            "text-anchor": "top",
            "text-allow-overlap": true
        },
        paint: {
            "text-color": "#1a4c2d",
            "text-halo-color": "rgba(255,255,255,0.9)",
            "text-halo-width": 1.2
        }
    });

    // Particle system
    const particles = [];
    const N = 150;
    const dispersion = 0.04;
    const baseSpeed = 0.035;
    const life = 140;
    const siteIntensities = new Map();
    const siteById = new Map(sites.map(s => [s.id, s]));

    sites.forEach(s => {
        for (let i = 0; i < N; i++) {
            particles.push({
                lat: s.lat,
                lon: s.lon,
                baseLat: s.lat,
                baseLon: s.lon,
                age: Math.random() * life,
                siteId: s.id,
                intensity: 1
            });
        }
    });

    let windDeg = 90;
    let speedFactor = 1;
    const emissionClockStart = performance.now();

    function siteIntensityAt(siteId, timestampMs) {
        const entry = emissionSeriesById.get(siteId);
        if (!entry || !entry.normalized.length) return 1;
        const pos = ((timestampMs - emissionClockStart) / 1000) / entry.stepSeconds;
        const idx = ((pos % entry.normalized.length) + entry.normalized.length) % entry.normalized.length;
        const i0 = Math.floor(idx);
        const i1 = (i0 + 1) % entry.normalized.length;
        const frac = idx - i0;
        const v0 = entry.normalized[i0];
        const v1 = entry.normalized[i1];
        return v0 + (v1 - v0) * frac;
    }

    function siteEmissionValueAt(siteId, timestampMs) {
        const entry = emissionSeriesById.get(siteId);
        if (entry && entry.values && entry.values.length) {
            const pos = ((timestampMs - emissionClockStart) / 1000) / entry.stepSeconds;
            const idx = ((pos % entry.values.length) + entry.values.length) % entry.values.length;
            const i0 = Math.floor(idx);
            const i1 = (i0 + 1) % entry.values.length;
            const frac = idx - i0;
            const v0 = entry.values[i0];
            const v1 = entry.values[i1];
            return v0 + (v1 - v0) * frac;
        }
        const site = siteById.get(siteId);
        if (site && typeof site.annual === "number" && !Number.isNaN(site.annual)) {
            return site.annual;
        }
        return null;
    }

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
    const netcdfOption = windPattern.querySelector('option[value="era5Netcdf"]');

    function updateWindLabel() {
        windValueEl.innerText = `${Math.round(windDeg)}° · ×${speedFactor.toFixed(2)}`;
    }

    netcdfSeriesPromise.then(series => {
        if (series && series.length) {
            windPatterns.era5Netcdf = t => {
                const virtualHour = (t / 30) % series.length;
                const i0 = Math.floor(virtualHour);
                const i1 = (i0 + 1) % series.length;
                const frac = virtualHour - i0;
                const seg0 = series[i0];
                const seg1 = series[i1];
                return {
                    deg: interpolateBearing(seg0.deg, seg1.deg, frac),
                    speed: seg0.speed + (seg1.speed - seg0.speed) * frac
                };
            };
            if (netcdfOption) {
                netcdfOption.disabled = false;
                netcdfOption.textContent = "ERA5 desde NetCDF";
            }
        } else if (netcdfOption) {
            netcdfOption.disabled = true;
            netcdfOption.textContent = "ERA5 NetCDF no disponible";
        }
    });

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
        properties: { age: p.age, intensity: p.intensity }
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
            "circle-radius": [
                "interpolate",
                ["linear"],
                ["get", "intensity"],
                0,
                1.2,
                1,
                2.6
            ],
            "circle-color": "rgba(255, 128, 0, 0.78)",
            "circle-opacity": [
                "*",
                [
                    "interpolate",
                    ["linear"],
                    ["get", "age"],
                    0,
                    0.95,
                    life,
                    0
                ],
                [
                    "interpolate",
                    ["linear"],
                    ["get", "intensity"],
                    0,
                    0.25,
                    1,
                    1
                ]
            ],
            "circle-blur": 0.15
        }
    });

    function stepParticles(siteIntensities) {
        const w = windField(windDeg);
        particles.forEach(p => {
            const intensity = siteIntensities.get(p.siteId) ?? 1;
            p.intensity = intensity;
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
            plumeFeatures[i].properties.intensity = particles[i].intensity;
        }
        map.getSource("plumes").setData(plumeGeoJSON);
    }

    function updateEmissionLabels(timestamp) {
        for (const feature of plantsGeoJSON.features) {
            const val = siteEmissionValueAt(feature.id, timestamp);
            const text = Number.isFinite(val) ? val.toFixed(2) : "…";
            feature.properties.emissionText = text;
        }
        map.getSource("plants").setData(plantsGeoJSON);
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
        siteIntensities.clear();
        for (const site of sites) {
            siteIntensities.set(site.id, siteIntensityAt(site.id, timestamp));
        }
        stepParticles(siteIntensities);
        if (timestamp - lastUpdate >= updateInterval) {
            updatePlumes();
            updateEmissionLabels(timestamp);
            lastUpdate = timestamp;
        }
        requestAnimationFrame(animate);
    }

    animate();
}

main();
