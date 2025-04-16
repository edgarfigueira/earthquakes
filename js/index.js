// 1) Inicializar o mapa e camadas base
const map = L.map("map", { zoomControl: false }).setView(
  [21.30985, -29.29688],
  2
);

// Bases (camadas de fundo)
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution:
    '© OpenStreetMap contributors, USGS Earthquake API | GeoDev: <a href="https://www.linkedin.com/in/edgarfigueira/">Edgar Figueira</a>'
});
const satellite = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    attribution:
      'Imagery © Esri, USGS Earthquake API | GeoDev: <a href="https://www.linkedin.com/in/edgarfigueira/">Edgar Figueira</a>'
  }
);
const dark_map = L.tileLayer(
  "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.{ext}",
  {
    minZoom: 0,
    maxZoom: 20,
    attribution:
      '© OpenStreetMap contributors, USGS Earthquake API | GeoDev: <a href="https://www.linkedin.com/in/edgarfigueira/">Edgar Figueira</a>',
    ext: "png"
  }
);
const OpenTopoMap = L.tileLayer(
  "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 17,
    attribution:
      "© OpenStreetMap contributors, USGS Earthquake API, Edgar Figueira"
  }
);

// Adiciona OSM como base default
osm.addTo(map);

// BaseMaps e Overlays
const baseMaps = {
  OpenStreetMap: osm,
  "ESRI satellite": satellite,
  "Dark Map": dark_map,
  OpenTopoMap: OpenTopoMap
};

// Overlays
const earthquakeMarkers = L.layerGroup();
let heatmapLayer;
let falhasLayer; // Precisamos disto no slider
const overlayMaps = {
  Earthquakes: earthquakeMarkers
};

// 2) Carregar Earthquakes
const earthquakeUrl =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

fetch(earthquakeUrl)
  .then((resp) => resp.json())
  .then((data) => {
    const heatData = [];
    const quakeCount = data.features.length;

    // Atualiza contador
    document.getElementById(
      "earthquake-count"
    ).textContent = `Earthquakes: ${quakeCount}`;

    // Create circleMarkers
    L.geoJSON(data, {
      pointToLayer: (feature, latlng) => {
        const mag = feature.properties.mag;
        const marker = L.circleMarker(latlng, {
          radius: mag * 3,
          fillColor: getColor(mag),
          color: "grey",
          weight: 0.7,
          opacity: 1,
          fillOpacity: 0.6
        });

        // When the marker is clicked:
        marker.on("click", () => {
          // 1) Fill the custom info box
          showEarthquakeInfo(feature.properties);

          // 2) Zoom/fly to the earthquake's location
          // e.g., map.setView(...) or map.flyTo(...)
          map.flyTo(latlng, 7); // zoom level 7, adjust as needed
          // OR:
          // map.flyTo(latlng, 7);
        });

        earthquakeMarkers.addLayer(marker);
        heatData.push([latlng.lat, latlng.lng, mag]);
        return marker; // Return the marker
      }
    }).addTo(earthquakeMarkers);

    earthquakeMarkers.addTo(map);

    function showEarthquakeInfo(props) {
      const box = document.getElementById("earthquake-info");
      box.innerHTML = `
        <h5 style="margin-top: 0;">Earthquake Details</h5>
        <p><strong>Location:</strong> ${props.place}</p>
        <p><strong>Magnitude:</strong> ${props.mag}</p>
        <p><strong>Time:</strong> ${new Date(props.time).toLocaleString()}</p>
      `;
    }

    // Heatmap
    heatmapLayer = L.heatLayer(heatData, {
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
    overlayMaps["Heatmap"] = heatmapLayer;

    // Carregar Placas e Falhas
    const placasUrl = "dados/placas_tectonicas/placas.geojson";
    const falhasUrl = "dados/falhas/falhas.geojson";

    Promise.all([
      fetch(placasUrl).then((r) => r.json()),
      fetch(falhasUrl).then((r) => r.json())
    ]).then(([placasData, falhasData]) => {
      // Placas
      const placasLayer = L.geoJSON(placasData, {
        style: {
          color: "orange",
          weight: 2,
          fillOpacity: 0,
          dashArray: "2, 12"
        },
        onEachFeature: (feature, layer) => {
          if (feature.properties.PLATE) {
            layer.bindTooltip(feature.properties.PLATE, {
              permanent: false,
              direction: "center",
              className: "plate-label"
            });
          }
        }
      });
      overlayMaps["Tectonic Plates"] = placasLayer;

      // Falhas
      falhasLayer = L.geoJSON(falhasData, {
        style: {
          color: "red",
          weight: 2.5
        },
        onEachFeature: (feature, layer) => {
          if (feature.properties.name && feature.properties.slip_type) {
            const popupContent = `
              <strong>Fault Name:</strong> ${feature.properties.name}<br>
              <strong>Slip Type:</strong> ${feature.properties.slip_type}
            `;
            layer.bindPopup(popupContent);
          }
        }
      });
      overlayMaps["Faults"] = falhasLayer;

      // Agora criamos controle de camadas e movemos para sidebar
      createLayerControl();
    });
  });

// Função cor p/ Earthquakes
function getColor(mag) {
  return mag > 5
    ? "#ff0000"
    : mag > 4
    ? "#ff7f00"
    : mag > 3
    ? "#ffff00"
    : mag > 2
    ? "#7fff00"
    : "#00ff00";
}

// 3) Criar e mover controle de camadas
function createLayerControl() {
  const layerControl = L.control.layers(baseMaps, overlayMaps, {
    collapsed: false
  });
  layerControl.addTo(map);

  // Move p/ a sidebar
  const controlContainer = document.querySelector(".leaflet-control-layers");
  document.getElementById("sidebar-layers").appendChild(controlContainer);
}

// 4) Legendas na sidebar
function getEarthquakeLegendHTML() {
  return `
    <div class="legend mb-3">
      <strong>Magnitude</strong><br>
      <i style="background:#ff0000"></i> 5+<br>
      <i style="background:#ff7f00"></i> 4-5<br>
      <i style="background:#ffff00"></i> 3-4<br>
      <i style="background:#7fff00"></i> 2-3<br>
      <i style="background:#00ff00"></i> < 2<br>
    </div>
  `;
}

function getHeatmapLegendHTML() {
  return `
    <div class="legend mb-3">
      <strong>Heatmap intensity</strong><br>
      <i style="background:blue"></i> Very Low<br>
      <i style="background:cyan"></i> Low<br>
      <i style="background:yellow"></i> Medium<br>
      <i style="background:orange"></i> High<br>
      <i style="background:red"></i> Very High<br>
    </div>
  `;
}

// Insere legendas
document.getElementById("sidebar-legends").innerHTML =
  getEarthquakeLegendHTML() + getHeatmapLegendHTML();

// 5) Slider p/ falhas
const sliderFaults = document.getElementById("faults-opacity");
sliderFaults.addEventListener("input", (e) => {
  const val = parseFloat(e.target.value);
  if (falhasLayer) {
    falhasLayer.setStyle({ opacity: val, fillOpacity: val });
  }
});

// 6) Leaflet extras
L.control.scale().addTo(map);

// Draw Control
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

const drawControl = new L.Control.Draw({
  position: "topleft",
  edit: { featureGroup: drawnItems },
  draw: {
    polyline: true,
    polygon: true,
    circle: false,
    rectangle: true,
    marker: true
  }
});
map.addControl(drawControl);
map.on(L.Draw.Event.CREATED, (e) => {
  drawnItems.addLayer(e.layer);
});

// 7) Botão de download (agora dentro da sidebar)
document.getElementById("download-button").addEventListener("click", () => {
  window.open(earthquakeUrl, "_blank");
});

// 8) Sidebar toggle
document
  .getElementById("hamburger-button")
  .addEventListener("click", function () {
    const sidebar = document.getElementById("sidebar");
    sidebar.classList.toggle("active");
    // Mudar ícone
    if (sidebar.classList.contains("active")) {
      this.innerHTML = "×";
    } else {
      this.innerHTML = "☰";
    }
  });

// 9) Atualizar data/hora
function updateDateTime() {
  const now = new Date();
  document.getElementById("date-time").textContent = now.toLocaleString();
}
updateDateTime();
setInterval(updateDateTime, 1000);

// We'll keep references to the device marker and watch ID
let deviceMarker = null;
let geoWatchId = null;

/**
 * watchPosition callback success:
 *   - gets coordinates
 *   - sets/updates deviceMarker on the map
 *   - optionally re-centers the map
 */
function handleGeoSuccess(position) {
  const lat = position.coords.latitude;
  const lng = position.coords.longitude;

  if (!deviceMarker) {
    // Create a new marker if doesn't exist
    deviceMarker = L.marker([lat, lng], {
      // optionally use a custom icon or style
      // icon: L.icon({ ... })
    }).addTo(map);

    // Optionally pan the map to your location the first time:
    map.setView([lat, lng], 10);
  } else {
    // Update existing marker location
    deviceMarker.setLatLng([lat, lng]);
  }
}

/**
 * watchPosition callback error:
 *   - handle user denying permission or other errors
 */
function handleGeoError(err) {
  console.warn("Geolocation error:", err.message);
  // optionally display something to the user
}

/**
 * Start watching device location
 */
function locateMe() {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by this browser.");
    return;
  }

  // Start watch if not started
  if (!geoWatchId) {
    geoWatchId = navigator.geolocation.watchPosition(
      handleGeoSuccess,
      handleGeoError,
      {
        enableHighAccuracy: true,
        timeout: 60000, // 60s
        maximumAge: 0
      }
    );
    console.log("Started watchPosition, id = " + geoWatchId);
  } else {
    console.log("Already watching position, id = " + geoWatchId);
  }
}
document.getElementById("locate-me-button").addEventListener("click", locateMe);
