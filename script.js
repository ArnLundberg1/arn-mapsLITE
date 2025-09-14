/* ---------- script.js med API-integration ---------- */

// Ladda config (hämtas från config.cfg via fetch)
let CONFIG = {};
fetch("config.cfg")
  .then(r => r.text())
  .then(text => {
    CONFIG = parseConfig(text);
    initMap();
  });

function parseConfig(text) {
  const lines = text.split("\n");
  const cfg = {};
  lines.forEach(line => {
    if (line.includes("=")) {
      const [key, val] = line.split("=");
      cfg[key.trim()] = val.trim();
    }
  });
  return cfg;
}

/* -------- Karta och standard -------- */
let map, lightTiles, darkTiles, userMarker, followMode = false, routeLayer = null;
function initMap() {
  map = L.map('map').setView([59.3293, 18.0686], 13);

  lightTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap & Carto'
  });
}

/* -------- GPS -------- */
navigator.geolocation.watchPosition(pos => {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  if (!userMarker) {
    userMarker = L.marker([lat, lng]).addTo(map).bindPopup("Du är här");
    map.setView([lat, lng], 15);
  } else {
    userMarker.setLatLng([lat, lng]);
    if (followMode) map.setView([lat, lng], map.getZoom());
  }
});

/* -------- Routing (bil, cykel, gång) -------- */
function startRouting(destLat, destLon) {
  if (!userMarker) { alert("Din position hittas inte ännu."); return; }
  const start = userMarker.getLatLng();
  const mode = localStorage.getItem("transport") || "driving";
  let profile = "driving";
  if (mode === "bike") profile = "cycling";
  if (mode === "walk") profile = "walking";
  if (mode === "transit") return startTransitRouting(start, destLat, destLon);

  const url = `${CONFIG.osrm}/${profile}/v1/${start.lng},${start.lat};${destLon},${destLat}?overview=full&geometries=geojson&steps=true`;

  fetch(url).then(r => r.json()).then(data => {
    if (routeLayer) map.removeLayer(routeLayer);
    const route = data.routes[0];
    routeLayer = L.geoJSON(route.geometry).addTo(map);
    map.fitBounds(routeLayer.getBounds());
  });
}

/* -------- Kollektivtrafik (SL API) -------- */
function startTransitRouting(start, destLat, destLon) {
  const url = `${CONFIG.sl_url}?key=${CONFIG.sl_key}&originCoordLat=${start.lat}&originCoordLong=${start.lng}&destCoordLat=${destLat}&destCoordLong=${destLon}`;
  fetch(url).then(r => r.json()).then(data => {
    console.log("SL data:", data);
    alert("Kollektivtrafikrutter hämtade (visa i UI senare).");
  });
}

/* -------- Trafikverket (olyckor, köer, vägarbeten) -------- */
function loadTrafficEvents() {
  const query = `
    <REQUEST>
      <LOGIN authenticationkey='${CONFIG.trafikverket_key}' />
      <QUERY objecttype='Situation'>
        <FILTER><EQ name='Deviation.IconId' value='1'/></FILTER>
      </QUERY>
    </REQUEST>`;

  fetch(CONFIG.trafikverket_url, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: query
  }).then(r => r.json()).then(data => {
    console.log("Trafikverket data:", data);
    // Exempel: markera händelser på kartan
    if (data.RESPONSE && data.RESPONSE.RESULT) {
      const events = data.RESPONSE.RESULT[0].Situation;
      events.forEach(ev => {
        if (ev.Deviation && ev.Deviation[0].Location) {
          const lat = ev.Deviation[0].Location[0].Point[0].LocationCoordinate.Latitude;
          const lon = ev.Deviation[0].Location[0].Point[0].LocationCoordinate.Longitude;
          L.marker([lat, lon], { icon: L.icon({ iconUrl: "warning.png", iconSize: [24,24] }) })
            .addTo(map)
            .bindPopup(`🚧 ${ev.Message}`);
        }
      });
    }
  });
}

/* -------- Laddstationer (OpenChargeMap) -------- */
function loadChargingStations(lat, lon) {
  const url = `${CONFIG.openchargemap}?output=json&latitude=${lat}&longitude=${lon}&distance=5`;
  fetch(url).then(r => r.json()).then(data => {
    data.forEach(station => {
      L.marker([station.AddressInfo.Latitude, station.AddressInfo.Longitude])
        .addTo(map)
        .bindPopup(`⚡ ${station.AddressInfo.Title}`);
    });
  });
}

/* -------- Sök (Nominatim) -------- */
function searchPlace(query) {
  fetch(`${CONFIG.nominatim}?q=${encodeURIComponent(query)}&format=json&limit=1`)
    .then(r => r.json()).then(data => {
      if (data && data[0]) {
        const lat = data[0].lat, lon = data[0].lon;
        const marker = L.marker([lat, lon]).addTo(map);
        marker.bindPopup(`
          <b>${data[0].display_name}</b><br>
          <button onclick="startRouting(${lat}, ${lon})">🚀 Starta rutt</button>
        `).openPopup();
        map.setView([lat, lon], 14);
      }
    });
}

document.getElementById("searchBtn").addEventListener("click", () => {
  const query = document.getElementById("searchInput").value;
  if (query) searchPlace(query);
});
