/* ─────────────────────────────────────────────
   put “Registo de DD-MM-AAAA” (yesterday) in the title
─────────────────────────────────────────────*/
(function setDynamicTitle() {
  const titleEl = document.getElementById("daily-title");
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1); // one day back

  // "31-12-2025"   (PT-BR / PT-PT style)
  const fmt = yesterday.toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });

  titleEl.textContent = `Registo de sismos do dia: ${fmt}`;
})();

/*─────────────────────────────────────────────────────────────
  USGS daily earthquakes – cleaned / fixed script
  (expects the same HTML structure you have been using)
─────────────────────────────────────────────────────────────*/

/******************** 0. GLOBALS ***************************/
const map = L.map("map", { zoomControl: false }).setView(
  [21.30985, -29.29688],
  2
);

let heatmapLayer, // Leaflet-heat layer
  falhasLayer, // geological faults layer (overlay)
  deviceMarker, // follows the device when geolocating
  geoWatchId, // watchPosition id
  lastAddrLatLng,
  earthquakeData,
  playHandle, // interval for the time animation
  activeMarker, // currently highlighted quake marker
  impactRing,
  impactLine,
  impactLabel; // graphics around a quake
const VISIBLE_FILL = 0.6; // the default fillOpacity we want when a quake is visible

const timeSlider = document.getElementById("time-slider");
const playBtn = document.getElementById("play-btn");
const hourLabel = document.getElementById("hour-label");

/******************** 1. BASEMAPS ***************************/
const stadia = L.tileLayer(
  "https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.{ext}",
  {
    ext: "png",
    maxZoom: 20,
    attribution: "© Stadia Maps | © OpenMapTiles | © OSM"
  }
);
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap"
});
const esri = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { attribution: "Imagery © Esri" }
);
const dark = L.tileLayer(
  "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.{ext}",
  { ext: "png", attribution: "© OSM contributors" }
);
const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenTopoMap"
});

stadia.addTo(map);

const baseMaps = {
  Stadia: stadia,
  OpenStreetMap: osm,
  "ESRI satellite": esri,
  "Dark map": dark,
  OpenTopoMap: topo
};

/******************** 2. CONSTANT STYLES *******************/
const HIGHLIGHT = { color: "#4BFFFF", weight: 3, opacity: 1, fillOpacity: 0.8 },
  NORMAL = { color: "grey", weight: 0.7, opacity: 1, fillOpacity: 0.6 };

/******************** 3. FETCH EARTHQUAKES *****************/
const earthquakeMarkers = L.layerGroup().addTo(map);
const overlayMaps = { Earthquakes: earthquakeMarkers };

const feedURL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

fetch(feedURL)
  .then((r) => r.json())
  .then((data) => {
    earthquakeData = data;
    document.getElementById(
      "earthquake-count"
    ).textContent = `Sismos: ${data.features.length}`;

    const heatPts = [];

    L.geoJSON(data, {
      pointToLayer: (f, ll) => {
        const mag = f.properties.mag;
        const marker = L.circleMarker(ll, {
          radius: mag * 3,
          fillColor: getColor(mag),
          color: "grey",
          weight: 0.7,
          opacity: 1,
          fillOpacity: VISIBLE_FILL
        });
        marker.on("click", () => {
          highlight(marker);
          showEqInfo(f.properties);
          map.flyTo(ll, 7, { duration: 0.8 });
        });
        earthquakeMarkers.addLayer(marker);
        heatPts.push([ll.lat, ll.lng, mag]);
        return marker;
      }
    });

    filterByHour(+timeSlider.value);

    heatmapLayer = L.heatLayer(heatPts, {
      radius: 75,
      blur: 45,
      maxZoom: 10,
      max: 10,
      gradient: {
        0.1: "blue",
        0.3: "cyan",
        0.5: "yellow",
        0.7: "orange",
        0.9: "red"
      }
    });
    overlayMaps["Mapa de Calor"] = heatmapLayer;

    /* plates + faults */
    Promise.all([
      fetch("dados/placas_tectonicas/placas.geojson").then((r) => r.json()),
      fetch("dados/falhas/falhas.geojson").then((r) => r.json())
    ]).then(([plates, faults]) => {
      const plateLyr = L.geoJSON(plates, {
        style: {
          color: "orange",
          weight: 2,
          fillOpacity: 0,
          dashArray: "2,12"
        },
        onEachFeature: (f, l) =>
          f.properties.PLATE &&
          l.bindTooltip(f.properties.PLATE, { className: "plate-label" })
      });
      falhasLayer = L.geoJSON(faults, {
        style: { color: "black", weight: 2.5 },
        onEachFeature: (f, l) =>
          f.properties.name &&
          l.bindPopup(
            `<strong>Fault:</strong> ${f.properties.name}<br><strong>Slip:</strong> ${f.properties.slip_type}`
          )
      });
      overlayMaps["Placas Tectónicas"] = plateLyr;
      overlayMaps["Falhas Geológicas"] = falhasLayer;
      createLayerControl();
    });
  });

/******************** 4. HIGHLIGHT & IMPACT *****************/
function getImpactRadiusKm(m) {
  return Math.round(2.5 * Math.pow(2, m));
}

function highlight(marker) {
  if (activeMarker && activeMarker !== marker) activeMarker.setStyle(NORMAL);
  [impactRing, impactLine, impactLabel].forEach((l) => l && map.removeLayer(l));

  marker.setStyle(HIGHLIGHT).bringToFront();
  activeMarker = marker;

  const mag = marker.feature.properties.mag,
    km = getImpactRadiusKm(mag),
    ll = marker.getLatLng();

  impactRing = L.circle(ll, {
    radius: km * 1000,
    fill: false,
    color: "#FF8000",
    weight: 2,
    dashArray: "6 4",
    interactive: false
  }).addTo(map);
  const endLat = ll.lat + km / 111;
  impactLine = L.polyline([ll, [endLat, ll.lng]], {
    color: "#FF8000",
    weight: 1.5,
    interactive: false
  }).addTo(map);
  impactLabel = L.marker([(ll.lat + endLat) / 2, ll.lng], {
    interactive: false,
    icon: L.divIcon({
      className: "impact-label",
      html: `${km.toLocaleString()} km`,
      iconSize: [0, 0]
    })
  }).addTo(map);
}

/******************** 5. TIME FILTER & ANIMATION ***********/
function filterByHour(h) {
  if (hourLabel)
    hourLabel.textContent = `Hora UTC: ${h.toString().padStart(2, "0")}-${(
      (h + 1) %
      24
    )
      .toString()
      .padStart(2, "0")} h`;
  earthquakeMarkers.eachLayer((marker) => {
    const hr = new Date(marker.feature.properties.time).getUTCHours();
    const show = marker === activeMarker || hr <= h;
    marker.setStyle({
      opacity: show ? 1 : 0,
      fillOpacity: show ? VISIBLE_FILL : 0 // ← always restore the real value
    });
  });
}

/* plain <input type="range"> slider (simpler to debug) */
timeSlider.addEventListener("input", (e) => filterByHour(+e.target.value));

function startAnim() {
  playBtn.textContent = "⏸";
  playHandle = setInterval(() => {
    let v = (+timeSlider.value + 1) % 24;
    timeSlider.value = v;
    filterByHour(v);
  }, 800);
}
function stopAnim() {
  clearInterval(playHandle);
  playHandle = null;
  playBtn.textContent = "▶︎";
}
playBtn.addEventListener("click", () =>
  playHandle ? stopAnim() : startAnim()
);

/******************** 6. SIDE INFO BOX *********************/
function showEqInfo(p) {
  const box = document.getElementById("earthquake-info");
  box.innerHTML = `<h5 class="mt-0">Detalhes sísmicos:</h5>
    <p><strong>Localização:</strong> ${p.place}</p>
    <p><strong>Magnitude:</strong> ${p.mag}</p>
    <p><strong>Data e hora:</strong> ${new Date(p.time).toLocaleString()}</p>
    <p><strong>Tsunami:</strong> ${p.tsunami === 0 ? "Não" : "Sim"}</p>
    <p><strong>Zona de impacto:</strong> ${getImpactRadiusKm(p.mag)} km</p>
    <p><strong>Fonte:</strong> <a href="${p.url}">Ver mais</a></p>`;
}
/******************** 7. LAYER CONTROL *********************/
function createLayerControl() {
  const ctrl = L.control
    .layers(baseMaps, overlayMaps, { collapsed: false })
    .addTo(map);
  document.getElementById("sidebar-layers").appendChild(ctrl.getContainer());
  addOpacitySliders(ctrl.getContainer());
}
function addOpacitySliders(div) {
  div
    .querySelectorAll(".leaflet-control-layers-overlays label")
    .forEach((label) => {
      const name = label.textContent.trim();
      const layer = overlayMaps[name];
      if (!layer) return;
      const input = Object.assign(document.createElement("input"), {
        type: "range",
        min: 0,
        max: 1,
        step: 0.1,
        value: 1,
        className: "opacity-slider ms-2"
      });
      input.oninput = (e) => setLayerOpacity(layer, parseFloat(e.target.value));
      label.appendChild(input);
    });
}
function setLayerOpacity(layer, val) {
  if (layer.setOpacity) {
    layer.setOpacity(val);
    return;
  }
  if (layer.setStyle) {
    layer.setStyle({ opacity: val, fillOpacity: val });
    return;
  }
  if (layer.eachLayer) {
    layer.eachLayer((l) => setLayerOpacity(l, val));
  }
}

/******************** 8. SIMPLE LEGENDS ********************/
buildLegends();
function buildLegends() {
  document.getElementById("sidebar-legends").innerHTML = `
    <div class="legend mb-3">
      <strong>Magnitude</strong><br>
      <i style="background:#ff0000"></i> 5+<br>
      <i style="background:#ff7f00"></i> 4-5<br>
      <i style="background:#ffff00"></i> 3-4<br>
      <i style="background:#7fff00"></i> 2-3<br>
      <i style="background:#00ff00"></i> < 2
    </div>
    <div class="legend mb-3">
      <strong>Mapa de Calor</strong><br>
      <i style="background:blue"></i> Muito Baixa<br>
      <i style="background:cyan"></i> Baixa<br>
      <i style="background:yellow"></i> Média<br>
      <i style="background:orange"></i> Alta<br>
      <i style="background:red"></i> Muito Alta
    </div>`;
}

/******************** 9. MAGNITUDE FILTER ******************/
const magSlider = document.getElementById("mag-slider");
const magVal = document.getElementById("mag-val");
magSlider.addEventListener("input", (e) => {
  const minMag = +e.target.value;
  magVal.textContent = minMag;
  earthquakeMarkers.eachLayer((m) => {
    const mag = m.feature.properties.mag;
    m.setStyle({
      opacity: mag >= minMag ? 1 : 0,
      fillOpacity: mag >= minMag ? 0.6 : 0
    });
  });
});

/******************** 10. GEO-LOCATE ***********************/
const locateBtn = document.getElementById("locate-me-button");
const DIST_LIMIT = 0.0001; // ≈10 m in lat/
let lastAddrLookup = { lat: null, lng: null }; // tiny cache

locateBtn.addEventListener("click", () =>
  geoWatchId ? stopLocate() : startLocate()
);

function startLocate() {
  if (!navigator.geolocation) {
    alert("Geolocalização não suportada.");
    return;
  }
  geoWatchId = navigator.geolocation.watchPosition(
    handleGeoSuccess,
    handleGeoError,
    {
      enableHighAccuracy: true,
      timeout: 60000,
      maximumAge: 0,
      distanceFilter: 20 // Safari / iOS only
    }
  );
  locateBtn.classList.add("active");
}

function stopLocate() {
  navigator.geolocation.clearWatch(geoWatchId);
  geoWatchId = null;
  if (deviceMarker) {
    map.removeLayer(deviceMarker);
    deviceMarker = null;
  }
  locateBtn.classList.remove("active");
}

function handleGeoSuccess({ coords }) {
  const { latitude: lat, longitude: lng, heading } = coords;
  updateLocatePopup(lat, lng, heading);
  map.setView([lat, lng], 10); // pan the map (first fix only)
}

function handleGeoError(e) {
  console.warn(e.message);
}

/* ---------- helpers --------------------------------------------------- */
function movedMoreThan10m(lat, lng) {
  return (
    !lastAddrLookup.lat ||
    Math.abs(lat - lastAddrLookup.lat) > DIST_LIMIT ||
    Math.abs(lng - lastAddrLookup.lng) > DIST_LIMIT
  );
}

function makePopupHTML(lat, lng, heading) {
  return `
    <strong>Lat/Lon:</strong>
      <span id="lat">${lat.toFixed(5)}</span>,
      <span id="lon">${lng.toFixed(5)}</span><br>
    <strong>Direcção:</strong>
      <span id="hdg">${
        heading != null && !isNaN(heading) ? Math.round(heading) + "°" : "–"
      }</span><br>
    <em id="rev-addr">A procurar endereço…</em>`;
}

function reverseGeocode(lat, lng, cb) {
  fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&email=nothing@example.com`
  )
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((d) => cb(d.display_name || "Endereço não encontrado"))
    .catch(() => cb("Falha na geocodificação"));
}

function updateLocatePopup(lat, lng, heading) {
  /* first fix → create marker & popup */
  if (!deviceMarker) {
    deviceMarker = L.marker([lat, lng])
      .addTo(map)
      .bindPopup(makePopupHTML(lat, lng, heading))
      .openPopup();
  } else {
    deviceMarker.setLatLng([lat, lng]);
    const box = deviceMarker.getPopup().getElement();
    box.querySelector("#lat").textContent = lat.toFixed(5);
    box.querySelector("#lon").textContent = lng.toFixed(5);
    box.querySelector("#hdg").textContent =
      heading != null && !isNaN(heading) ? Math.round(heading) + "°" : "–";
  }

  /* skip reverse-geocode if we haven’t moved enough */
  if (!movedMoreThan10m(lat, lng)) return;

  const addrEl = deviceMarker
    .getPopup()
    .getElement()
    .querySelector("#rev-addr");
  addrEl.textContent = "A procurar endereço…";

  reverseGeocode(lat, lng, (address) => {
    addrEl.textContent = address;
    lastAddrLookup = { lat, lng }; // update tiny cache
  });
}

/******************** 11. DOWNLOAD GEOJSON *****************/
const dlBtn = document.getElementById("download-button");
dlBtn.addEventListener("click", () => {
  if (!earthquakeData) return;
  const blob = new Blob([JSON.stringify(earthquakeData, null, 2)], {
    type: "application/geo+json"
  });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: `earthquakes_${new Date().toISOString().slice(0, 10)}.geojson`
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

/******************** 12. SIDEBAR TOGGLE *******************/
document
  .getElementById("hamburger-button")
  .addEventListener("click", function () {
    const sb = document.getElementById("sidebar");
    sb.classList.toggle("active");
    this.textContent = sb.classList.contains("active") ? "×" : "☰";
  });

/******************** 13. CLOCK ***************************/
setInterval(
  () =>
    (document.getElementById("date-time").textContent =
      new Date().toLocaleString()),
  1000
);

/******************** 14. HELPERS *************************/
function getColor(m) {
  return m > 5
    ? "#f00"
    : m > 4
    ? "#ff7f00"
    : m > 3
    ? "#ff0"
    : m > 2
    ? "#7f0"
    : "#0f0";
}
