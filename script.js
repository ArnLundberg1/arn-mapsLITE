// Ladda konfiguration
let CONFIG = {};
fetch("config.cfg")
  .then(r => r.json())
  .then(cfg => { CONFIG = cfg; initMap(); });

let map, routingControl, currentPosMarker, follow = false, mode = "driving";

// Initiera Leaflet
function initMap() {
  map = L.map('map').setView([59.3293, 18.0686], 13);

  const lightTiles = L.tileLayer(CONFIG.tiles.light, { attribution: CONFIG.attribution }).addTo(map);
  const darkTiles = L.tileLayer(CONFIG.tiles.dark, { attribution: CONFIG.attribution });

  // Tema-knapp
  let darkMode = false;
  document.getElementById("themeBtn").addEventListener("click", () => {
    if (darkMode) {
      map.removeLayer(darkTiles);
      lightTiles.addTo(map);
    } else {
      map.removeLayer(lightTiles);
      darkTiles.addTo(map);
    }
    darkMode = !darkMode;
  });

  // GPS
  if (navigator.geolocation) {
    navigator.geolocation.watchPosition(pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      if (!currentPosMarker) {
        currentPosMarker = L.marker([lat, lng]).addTo(map).bindPopup("Du är här");
      } else {
        currentPosMarker.setLatLng([lat, lng]);
      }
      if (follow) map.setView([lat, lng], 15);
    });
  }

  // Följ-knapp
  document.getElementById("followBtn").addEventListener("click", () => follow = !follow);

  // Transport-läge
  document.getElementById("carBtn").addEventListener("click", () => mode = "driving");
  document.getElementById("bikeBtn").addEventListener("click", () => mode = "cycling");
  document.getElementById("walkBtn").addEventListener("click", () => mode = "walking");

  // Sök
  document.getElementById("searchBtn").addEventListener("click", () => {
    const q = document.getElementById("searchInput").value;
    searchPlace(q);
  });
}

// Sök plats via Nominatim
function searchPlace(query) {
  fetch(`${CONFIG.nominatim}?q=${encodeURIComponent(query)}&format=json&limit=1`)
    .then(r => r.json())
    .then(data => {
      if (data && data[0]) {
        const lat = data[0].lat, lon = data[0].lon;
        L.marker([lat, lon]).addTo(map).bindPopup(data[0].display_name).openPopup();
        map.setView([lat, lon], 14);
        startRouting(lat, lon);
      }
    });
}

// Starta ruttplanering via OSRM
function startRouting(destLat, destLon) {
  if (routingControl) map.removeControl(routingControl);

  if (!currentPosMarker) return;

  const [startLat, startLon] = currentPosMarker.getLatLng();

  routingControl = L.Routing.control({
    waypoints: [
      L.latLng(startLat, startLon),
      L.latLng(destLat, destLon)
    ],
    router: L.Routing.osrmv1({
      serviceUrl: CONFIG.osrm + '/' + mode
    }),
    lineOptions: { styles: [{ color: 'blue', weight: 4 }] },
    createMarker: () => null
  }).addTo(map);

  routingControl.on('routesfound', e => {
    const steps = e.routes[0].instructions || [];
    let out = "<ol>";
    e.routes[0].instructions.forEach(s => {
      out += `<li>${s.text}</li>`;
      speak(s.text); // TTS
    });
    out += "</ol>";
    document.getElementById("routeInfo").innerHTML = out;
  });
}

// TTS
function speak(text) {
  if ('speechSynthesis' in window) {
    const msg = new SpeechSynthesisUtterance(text);
    speechSynthesis.speak(msg);
  }
}
