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
  impactLabel, // graphics around a quake
  layerCtrl;

const VISIBLE_FILL = 0.6; // the default fillOpacity we want when a quake is visible

function createLayerControl() {
  if (layerCtrl) map.removeControl(layerCtrl); // apaga o anterior
  layerCtrl = L.control
    .layers(baseMaps, overlayMaps, { collapsed: false })
    .addTo(map);

  const sidebar = document.getElementById("sidebar-layers");
  sidebar.innerHTML = ""; // limpa conteúdo anterior
  sidebar.appendChild(layerCtrl.getContainer());
  addOpacitySliders(layerCtrl.getContainer());
}

const timeSlider = document.getElementById("time-slider");
const playBtn = document.getElementById("play-btn");
const hourLabel = document.getElementById("hour-label");

/******************** 1. BASEMAPS ***************************/

const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap"
});
const esri = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { attribution: "Imagery © Esri" }
);

const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenTopoMap"
});

osm.addTo(map);

const baseMaps = {
  OpenStreetMap: osm,
  "ESRI satellite": esri,
  OpenTopoMap: topo
};

/******************** 2. CONSTANT STYLES *******************/
const HIGHLIGHT = { color: "#4BFFFF", weight: 3, opacity: 1, fillOpacity: 0.8 },
  NORMAL = { color: "grey", weight: 0.7, opacity: 1, fillOpacity: 0.6 };

/******************** 3. FETCH EARTHQUAKES *****************/
const earthquakeMarkers = L.layerGroup().addTo(map);
const overlayMaps = { Earthquakes: earthquakeMarkers };

/******************** MAGNITUDE FILTER (checkboxes) *******************/
let activeMagClasses = new Set(); // classes actualmente visíveis  (0-1, 1-2 …)
let currentHour = 23; // hora activa do time-slider

/* devolve o inteiro da classe (0-1 ⇒ 0, 1-2 ⇒ 1 …)  */
function getMagClass(m) {
  return Math.max(0, Math.floor(m)); // <0 ⇒ classe 0
}

/* cria as checkboxes consoante as magnitudes presentes */
function buildMagCheckboxes(features) {
  const maxMag = Math.ceil(Math.max(...features.map((f) => f.properties.mag)));
  const cont = document.getElementById("mag-checkboxes");
  cont.innerHTML = ""; // limpa anteriores

  for (let c = 0; c <= maxMag; c++) {
    const id = `magcls-${c}`;
    const wrapper = document.createElement("div");
    wrapper.className = "form-check";

    const cb = Object.assign(document.createElement("input"), {
      type: "checkbox",
      className: "form-check-input",
      id,
      value: c,
      checked: true
    });
    cb.addEventListener("change", applyMagFilter);

    const label = Object.assign(document.createElement("label"), {
      className: "form-check-label",
      htmlFor: id,
      textContent: c === maxMag ? `${c}+` : `${c}-${c + 1}`
    });

    wrapper.append(cb, label);
    cont.appendChild(wrapper);
  }
  // todas activas por defeito
  activeMagClasses = new Set(Array.from({ length: maxMag + 1 }, (_, k) => k));
}

/* recalcula set de classes activas e actualiza marcadores */
function applyMagFilter() {
  activeMagClasses = new Set(
    Array.from(
      document.querySelectorAll("#mag-checkboxes input:checked"),
      (cb) => +cb.value
    )
  );
  earthquakeMarkers.eachLayer(updateMarkerVisibility);
}

/* decide visibilidade de cada marcador (hora + magnitude) */
function updateMarkerVisibility(marker) {
  const hr = new Date(marker.feature.properties.time).getUTCHours();
  const cls = getMagClass(marker.feature.properties.mag);

  const visible =
    marker === activeMarker || // permanece realçado
    (hr <= currentHour && activeMagClasses.has(cls));

  marker.setStyle({
    opacity: visible ? 1 : 0,
    fillOpacity: visible ? VISIBLE_FILL : 0
  });
}

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

    buildMagCheckboxes(data.features);
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

    /* 6. Core routine – show / hide markers ------------------- */

    /* first run ------------------------------------------------*/
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
  currentHour = h;
  if (hourLabel)
    hourLabel.textContent = `Hora UTC: ${h.toString().padStart(2, "0")}-${(
      (h + 1) %
      24
    )
      .toString()
      .padStart(2, "0")} h`;
  earthquakeMarkers.eachLayer(updateMarkerVisibility);
  earthquakeMarkers.eachLayer((marker) => {
    const hr = new Date(marker.feature.properties.time).getUTCHours();
    const show = marker === activeMarker || hr <= h;
    marker.setStyle({
      opacity: show ? 1 : 0,
      fillOpacity: show ? VISIBLE_FILL : 0 // ← always restore the real value
    });
  });
  earthquakeMarkers.eachLayer(updateMarkerVisibility);
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

/******************** 11-BIS. UPLOAD GEOJSON / KML *******************/
const uploadBtn = document.getElementById("upload-button");
const fileInput = document.getElementById("file-input");

uploadBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", handleFileSelect);

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const isKml = /\.kml$/i.test(file.name);
  const reader = new FileReader();
  reader.onload = (evt) => {
    let geojson;
    try {
      if (isKml) {
        /* converte KML → GeoJSON (biblioteca togeojson já incluída no HTML) */
        const dom = new DOMParser().parseFromString(
          evt.target.result,
          "text/xml"
        );
        geojson = toGeoJSON.kml(dom);
      } else {
        geojson = JSON.parse(evt.target.result);
      }
    } catch (err) {
      alert("Ficheiro inválido ou não suportado.");
      return;
    }

    /* cria camada Leaflet */
    const lyr = L.geoJSON(geojson, {
      style: NORMAL,
      pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 6, ...NORMAL })
    }).addTo(map);

    const name = file.name.replace(/\.[^.]+$/, "");
    overlayMaps[name] = lyr; // torna-o seleccionável no painel
    createLayerControl(); // reconstrói o controlo de camadas
    map.fitBounds(lyr.getBounds());
    buildMagCheckboxes(geojson.features);
    filterByHour(currentHour);   // volta a aplicar filtros com as novas classes

  };

  reader.readAsText(file);
}

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
