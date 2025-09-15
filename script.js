// Globala variabler
let map;
let userMarker;
let routeLayer;
let destinationMarker;

// ======================= INIT KARTA =======================
function initMap() {
  map = L.map("map").setView([59.3293, 18.0686], 13); // default Stockholm

  L.tileLayer(CONFIG.map.tileUrl, {
    attribution: CONFIG.map.attribution,
    subdomains: "abc",
    maxZoom: 20
  }).addTo(map);

  // Hämta användarens position
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      userMarker = L.marker([lat, lon], { draggable: false })
        .addTo(map)
        .bindPopup("Du är här")
        .openPopup();

      map.setView([lat, lon], 14);
    });
  }

  // Ladda externa datakällor
  loadTrafficIncidents();
  loadWeatherAlerts();
  loadChargingStations();
  loadParking();
  // loadPublicTransport(); // Kräver API-nycklar
}

// ======================= SÖKNING =======================
function searchPlace(query) {
  fetch(`${CONFIG.nominatim}?q=${encodeURIComponent(query)}&format=json&limit=1`)
    .then(r => r.json())
    .then(data => {
      if (data && data[0]) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        const name = data[0].display_name;

        addDestinationMarker(lat, lon, name);
        map.setView([lat, lon], 14);
      }
    });
}

// ======================= DESTINATION MARKER =======================
function addDestinationMarker(lat, lon, name) {
  if (destinationMarker) {
    map.removeLayer(destinationMarker);
  }

  destinationMarker = L.marker([lat, lon]).addTo(map);
  destinationMarker.bindPopup(`
    <b>${name}</b><br>
    <button onclick="startRoute(${lat}, ${lon})">🚀 Starta rutt</button>
    <button onclick="clearRoute()">❌ Avbryt</button>
  `);
  destinationMarker.openPopup();

  destinationMarker.on("popupclose", () => {
    clearRoute();
  });
}

// ======================= ROUTING =======================
function startRoute(destLat, destLon) {
  if (!userMarker) {
    alert("Ingen startposition hittades!");
    return;
  }

  const userPos = userMarker.getLatLng();
  const url = `${CONFIG.osrm}/route/v1/driving/${userPos.lng},${userPos.lat};${destLon},${destLat}?geometries=geojson&overview=full&steps=true`;

  fetch(url)
    .then(r => r.json())
    .then(data => {
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];

        if (routeLayer) {
          map.removeLayer(routeLayer);
        }

        routeLayer = L.geoJSON(route.geometry, {
          style: { color: "blue", weight: 5 }
        }).addTo(map);
        map.fitBounds(routeLayer.getBounds());

        showDirections(route.legs[0].steps);
      }
    });
}

// ======================= DIRECTIONS =======================
function showDirections(steps) {
  const dirBox = document.getElementById("directions");
  dirBox.innerHTML = "<h3>Färdbeskrivning</h3><ol id='dirList'></ol>";

  const dirList = document.getElementById("dirList");
  steps.forEach(step => {
    const li = document.createElement("li");
    li.textContent = step.maneuver.instruction;
    dirList.appendChild(li);
  });

  const done = document.createElement("p");
  done.innerHTML = "<b>Du har nått ditt mål.</b>";
  dirBox.appendChild(done);

  setTimeout(clearRoute, 5000);
}

// ======================= RENSNING =======================
function clearRoute() {
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  if (destinationMarker) {
    map.removeLayer(destinationMarker);
    destinationMarker = null;
  }

  const dirBox = document.getElementById("directions");
  dirBox.innerHTML = "<h3>Färdbeskrivning</h3><p>Ingen rutt aktiv.</p>";
}

// ======================= TRAFIKVERKET =======================
function loadTrafficIncidents() {
  if (!CONFIG.trafikverket.apiKey) return;

  fetch(CONFIG.trafikverket.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: `
      <REQUEST>
        <LOGIN authenticationkey="${CONFIG.trafikverket.apiKey}" />
        <QUERY objecttype="Situation" schemaversion="1">
          <FILTER>
            <IN name="Deviation.IconId" value="1,2,3,4,5,6,7,8" />
          </FILTER>
        </QUERY>
      </REQUEST>
    `
  })
    .then(r => r.json())
    .then(data => {
      if (!data.RESPONSE) return;
      data.RESPONSE.RESULT[0].Situation.forEach(sit => {
        if (!sit.Deviation || !sit.Deviation[0].Geometry) return;
        const coords = sit.Deviation[0].Geometry.WGS84.match(/(\d+\.\d+) (\d+\.\d+)/);
        if (coords) {
          const lat = parseFloat(coords[2]);
          const lon = parseFloat(coords[1]);
          L.marker([lat, lon], { title: "Trafikstörning" })
            .addTo(map)
            .bindPopup(`<b>Trafikstörning</b><br>${sit.Deviation[0].Message}`);
        }
      });
    })
    .catch(err => console.error("Trafikverket error:", err));
}

// ======================= VÄDER (SMHI/OpenWeather) =======================
function loadWeatherAlerts() {
  if (!CONFIG.weather.apiUrl) return;

  fetch(CONFIG.weather.apiUrl)
    .then(r => r.json())
    .then(data => {
      if (!data || !data.alert) return;
      data.alert.forEach(alert => {
        const lat = alert.coordinates[1];
        const lon = alert.coordinates[0];
        L.circle([lat, lon], {
          radius: 2000,
          color: "orange"
        }).addTo(map)
          .bindPopup(`<b>Vädervarning</b><br>${alert.description}`);
      });
    })
    .catch(err => console.error("Weather API error:", err));
}

// ======================= LADDSTATIONER =======================
function loadChargingStations() {
  if (!CONFIG.charging.apiUrl) return;

  fetch(`${CONFIG.charging.apiUrl}?output=json&countrycode=SE&maxresults=20`)
    .then(r => r.json())
    .then(data => {
      data.forEach(station => {
        if (station.AddressInfo) {
          L.marker([station.AddressInfo.Latitude, station.AddressInfo.Longitude], { title: "Laddstation" })
            .addTo(map)
            .bindPopup(`<b>Laddstation</b><br>${station.AddressInfo.Title}`);
        }
      });
    })
    .catch(err => console.error("Charging API error:", err));
}

// ======================= PARKERING =======================
function loadParking() {
  if (!CONFIG.parking.apiUrl) return;

  fetch(CONFIG.parking.apiUrl)
    .then(r => r.json())
    .then(data => {
      data.forEach(p => {
        L.marker([p.lat, p.lon], { title: "Parkering" })
          .addTo(map)
          .bindPopup(`<b>Parkering</b><br>${p.name}`);
      });
    })
    .catch(err => console.error("Parking API error:", err));
}

// ======================= KOLLEKTIVTRAFIK (placeholder) =======================
function loadPublicTransport() {
  if (!CONFIG.publicTransport.sl.apiKey) return;
  console.log("Kollektivtrafik API integration kräver extra implementation.");
}

// ======================= EVENT HANDLERS =======================
document.addEventListener("DOMContentLoaded", () => {
  initMap();

  document.getElementById("searchBtn").addEventListener("click", () => {
    const q = document.getElementById("searchInput").value;
    if (q) searchPlace(q);
  });

  document.getElementById("searchInput").addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      const q = document.getElementById("searchInput").value;
      if (q) searchPlace(q);
    }
  });
});
