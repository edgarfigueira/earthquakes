// Initialize the map
const map = L.map("map").setView([21.30985, -29.29688], 2); // Centered on California

// Base layers
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
});

const satellite = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    attribution: 'Imagery © <a href="https://www.arcgis.com/">Esri</a>'
  }
);

const dark_map = L.tileLayer(
  "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.{ext}",
  {
    minZoom: 0,
    maxZoom: 20,
    attribution:
      '&copy; <a href="https://www.stadiamaps.com/" target="_blank">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    ext: "png"
  }
);

const OpenTopoMap = L.tileLayer(
  "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 17,
    attribution:
      'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
  }
);

// Add OSM as the default basemap
osm.addTo(map);

// Layers control (base maps)
const baseMaps = {
  OpenStreetMap: osm,
  "ESRI satellite": satellite,
  "Stadia Alidade Smooth Dark map": dark_map,
  OpenTopoMap: OpenTopoMap
};

// Layers for the earthquake data
const earthquakeMarkers = L.layerGroup(); // For circle markers
let heatmapLayer; // Will be defined after data is loaded

// Add the layer control to the map (basemaps + empty overlay for earthquake layers)
const overlayMaps = {
  Earthquakes: earthquakeMarkers
};

// Fetch the USGS GeoJSON earthquake data
const earthquakeUrl =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

fetch(earthquakeUrl)
  .then((response) => response.json())
  .then((data) => {
    const heatData = []; //Array to store the heatmap values
    const earthquakeCount = data.features.length; // Count the number of earthquakes

    // Update the counter display
    document.getElementById(
      "earthquake-count"
    ).textContent = `Earthquakes: ${earthquakeCount}`;

    L.geoJSON(data, {
      pointToLayer: function (feature, latlng) {
        // Style the markers based on magnitude
        const mag = feature.properties.mag; // Get the magnitude field
        const radius = mag * 3; // Scale the radius by magnitude

        // Create circle marker
        const marker = L.circleMarker(latlng, {
          radius: radius,
          fillColor: getColor(mag),
          color: "grey",
          weight: 0.7,
          opacity: 1,
          fillOpacity: 0.6
        });

        // Add click event to zoom to point
        //marker.on('click', function (e) {
          //map.setView(e.latlng, 6);
        //});

        // Bind popup to the circle marker
        marker.bindPopup(`<strong>Location:</strong> ${
          feature.properties.place
        }<br>
                          <strong>Magnitude:</strong> ${
                            feature.properties.mag
                          }<br>
                          <strong>Time:</strong> ${new Date(
                            feature.properties.time
                          ).toLocaleString()}`);

        // Add the marker to the earthquakeMarkers layer
        earthquakeMarkers.addLayer(marker);

        // Add points to heatmap data (magnitude as weight)
        heatData.push([latlng.lat, latlng.lng, mag]); // [latitude, longitude, magnitude (weight)]

        return marker; // Return the marker
      }
    }).addTo(earthquakeMarkers);

    // Add the earthquake markers to the map
    earthquakeMarkers.addTo(map);

    // Create heatmap layer (weighted by magnitude)
    heatmapLayer = L.heatLayer(heatData, {
      radius: 75,
      blur: 45,
      maxZoom: 10,
      max: 10, // max
      gradient: {
        0.1: "blue", // Cold spots (low intensity)
        0.3: "cyan", // Medium-low intensity
        0.5: "yellow", // Medium intensity (close areas)
        0.7: "orange", // Higher intensity
        0.9: "red" // High intensity (hotspots)
      }
    });

    // Add the heatmap layer as a toggle option in the overlays
    overlayMaps["Heatmap"] = heatmapLayer;

    // Fetch GeoJSON data for polylines and polygons
    const placasUrl = "dados/placas_tectonicas/placas.geojson"; // Adjust path if necessary
    const falhasUrl = "dados/falhas/falhas.geojson"; // Adjust path if necessary

    // Add the layer control after all layers are added
    Promise.all([
      fetch(placasUrl).then((response) => response.json()),
      fetch(falhasUrl).then((response) => response.json())
    ]).then(([placasData, falhasData]) => {
      const placasLayer = L.geoJSON(placasData, {
        style: {
          color: "orange",
          weight: 2,
          fillOpacity: 0.0,
          dashArray: "2, 12"
        },
        onEachFeature: function (feature, layer) {
          // Check if the feature has the "PLATE" property
          if (feature.properties.PLATE) {
            layer.bindTooltip(feature.properties.PLATE, {
              permanent: false,
              direction: "center",
              className: "plate-label" // Custom class for styling
            });
          }
          
          
        }
      });

      const falhasLayer = L.geoJSON(falhasData, {
        style: {
          color: "red",
          weight: 2.5
        },
        onEachFeature: function (feature, layer) {
          // Check if the feature has both "name" and "slip_type" properties
          if (feature.properties.name && feature.properties.slip_type) {
            const popupContent = `
          <strong>Fault Name:</strong> ${feature.properties.name}<br>
          <strong>Slip Type:</strong> ${feature.properties.slip_type}
        `;
            layer.bindPopup(popupContent);
          }
        }
      });

      overlayMaps["Tectonic Plates"] = placasLayer;
      overlayMaps["Faults"] = falhasLayer;

      L.control.layers(baseMaps, overlayMaps).addTo(map);
    });
    // Add the point and heatmap legends
    addEarthquakeLegend();
    addHeatmapLegend();
  });
//-----------------------------------------------------------------
// Function to style proportional circles based on earthquake magnitude
function getColor(magnitude) {
  return magnitude > 5
    ? "#ff0000"
    : magnitude > 4
    ? "#ff7f00"
    : magnitude > 3
    ? "#ffff00"
    : magnitude > 2
    ? "#7fff00"
    : "#00ff00"; // Low magnitude
}
//-------------------------------------------------------
// Function to add proportional earthquake circles legend
function addEarthquakeLegend() {
  var legend = L.control({ position: "bottomright" });
  legend.onAdd = function () {
    const div = L.DomUtil.create("div", "legend");
    div.innerHTML += "<strong>Magnitude</strong><br>";
    div.innerHTML += '<i style="background:#ff0000"></i> 5+<br>';
    div.innerHTML += '<i style="background:#ff7f00"></i> 4-5<br>';
    div.innerHTML += '<i style="background:#ffff00"></i> 3-4<br>';
    div.innerHTML += '<i style="background:#7fff00"></i> 2-3<br>';
    div.innerHTML += '<i style="background:#00ff00"></i> < 2<br>';
    return div;
  };  legend.addTo(map);
}
//------------------------------------------------
// Heatmap Legend
function addHeatmapLegend() {
  var heatLegend = L.control({ position: "bottomright" });

  heatLegend.onAdd = function () {
    var div = L.DomUtil.create("div", "legend"),
      grades = [0.1, 0.3, 0.5, 0.7, 0.9],
      colors = ["blue", "cyan", "yellow", "orange", "red"],
      labels = ["Very Low", "Low", "Medium", "High", "Very High"];

    div.innerHTML = "<strong>Heatmap intensity</strong><br>";

    // Loop through the intensity values and generate a label with color for each range
    for (var i = 0; i < grades.length; i++) {
      div.innerHTML +=
        '<i style="background:' + colors[i] + '"></i> ' + labels[i] + "<br>";
    }

    return div;
  };

  heatLegend.addTo(map);
}
//--------------------------------------------
// Add scale to the map
L.control.scale().addTo(map);
//--------------------------------------------
// Initialize the Leaflet Draw Control
var drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

var drawControl = new L.Control.Draw({
  edit: {
    featureGroup: drawnItems
  },
  draw: {
    polyline: true,
    polygon: true,
    circle: true,
    rectangle: true,
    marker: true
  }
});
map.addControl(drawControl);

// Handle the event creation of shapes
map.on(L.Draw.Event.CREATED, function (e) {
  var layer = e.layer;
  drawnItems.addLayer(layer);
});
//--------------------------------------------
// Function to download earthquakes features as GeoJSON
document
  .querySelector(".download-button")
  .addEventListener("click", function () {
    window.open(earthquakeUrl, "_blank");
  });
