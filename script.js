let CONFIG = {};
fetch("config.cfg")
  .then(r => r.json())
  .then(cfg => { CONFIG = cfg; initMap(); });

let map, routingControl, currentPosMarker;
let mode = "driving";
let darkMode = false;

// Initiera kartan
function initMap() {
  map = L.map('map').setView([59.3293, 18.0686], 13);

  const lightTiles = L.tileLayer(CONFIG.tiles.light, { attribution: CONFIG.attribution }).addTo(map);
  const darkTiles = L.tileLayer(CONFIG.tiles.dark, { attribution: CONFIG.attribution });

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
    });
  }

  // Sök
  document.getElementById("searchBtn").addEventListener("click", () => {
    const q = document.getElementById("searchInput").value;
    searchPlace(q);
  });

  // Inställningar
  document.getElementById("settingsBtn").addEventListener("click", () => {
    document.getElementById("settingsPanel").classList.remove("hidden");
  });
  document.getElementById("closeSettings").addEventListener("click", () => {
    document.getElementById("settingsPanel").classList.add("hidden");
  });

  document.getElementById("themeSelect").addEventListener("change", e => {
    if (e.target.value === "dark") {
      map.removeLayer(lightTiles);
      darkTiles.addTo(map);
    } else {
      map.removeLayer(darkTiles);
      lightTiles.addTo(map);
    }
  });

  document.getElementById("modeSelect").addEventListener("change", e => {
    mode = e.target.value;
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

// Starta rutt
function startRouting(destLat, destLon) {
  if (routingControl) map.removeControl(routingControl);
  if (!currentPosMarker) return;

  const [startLat, startLon] = currentPosMarker.getLatLng();

  // Om kollektivtrafik → hämta från API istället för OSRM
  if (mode === "transit") {
    document.getElementById("routeInfo").innerHTML = 
      "Kollektivtrafik kräver API (SL/Västtrafik).";
    return;
  }

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
    let out = "<ol>";
    e.routes[0].instructions.forEach(s => {
      out += `<li>${s.text}</li>`;
      speak(s.text);
    });
    out += "</ol>";
    document.getElementById("routeInfo").innerHTML = out;
  });
}

// Text-to-speech
function speak(text) {
  if ('speechSynthesis' in window) {
    const msg = new SpeechSynthesisUtterance(text);
    speechSynthesis.speak(msg);
  }
}
