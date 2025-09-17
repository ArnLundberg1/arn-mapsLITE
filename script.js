// === Globala variabler ===
let map, userMarker, destinationMarker, routeLayer;
let directions = [];
let currentStep = 0;
let followUser = false;
let selectedMode = localStorage.getItem("transportMode") || "driving";

// === Initiera kartan ===
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  initUI();
  restoreSettings();
});

// === Kartinitiering ===
function initMap() {
  map = L.map("map").setView([59.3293, 18.0686], 13); // Start: Stockholm

  const light = L.tileLayer(window.APP_CONFIG.map.tiles.light, {
    attribution: window.APP_CONFIG.map.attribution,
  });
  const dark = L.tileLayer(window.APP_CONFIG.map.tiles.dark, {
    attribution: window.APP_CONFIG.map.attribution,
  });

  light.addTo(map);
  map._layersControl = { light, dark };

  locateUser();
}

// === UI-kopplingar ===
function initUI() {
  document.getElementById("searchBtn").addEventListener("click", () => {
    const query = document.getElementById("searchInput").value.trim();
    if (query) searchPlace(query);
  });

  document.querySelectorAll(".mode").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedMode = btn.dataset.mode;
      localStorage.setItem("transportMode", selectedMode);
      toast(`Färdmedel: ${btn.innerText}`);
    });
  });

  document.getElementById("btnNextStep").addEventListener("click", nextStep);
  document.getElementById("btnPrevStep").addEventListener("click", prevStep);
  document.getElementById("btnCancelRoute").addEventListener("click", cancelRoute);

  // Inställningar
  document.getElementById("btnSettings").addEventListener("click", () => {
    document.getElementById("settingsModal").classList.remove("hidden");
  });
  document.getElementById("closeSettings").addEventListener("click", () => {
    document.getElementById("settingsModal").classList.add("hidden");
  });
  document.getElementById("saveSettingsBtn").addEventListener("click", saveSettings);

  document.getElementById("btnLocate").addEventListener("click", () => {
    followUser = true;
    locateUser();
  });
}

// === Användarens position ===
function locateUser() {
  if (!navigator.geolocation) {
    toast("GPS ej tillgänglig");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      if (!userMarker) {
        userMarker = L.marker([latitude, longitude], { icon: L.icon({ iconUrl: "https://cdn-icons-png.flaticon.com/512/447/447031.png", iconSize: [32, 32] }) }).addTo(map);
      } else {
        userMarker.setLatLng([latitude, longitude]);
      }
      if (followUser) map.setView([latitude, longitude], 15);
    },
    () => toast("Kunde inte hämta plats"),
    { enableHighAccuracy: true }
  );
}

// === Sökning via Nominatim ===
function searchPlace(query) {
  const url = `${window.APP_CONFIG.nominatim}?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1&accept-language=sv`;
  fetch(url)
    .then((r) => r.json())
    .then((data) => {
      if (!data.length) return toast("Ingen plats hittad");
      const place = data[0];
      const lat = parseFloat(place.lat);
      const lon = parseFloat(place.lon);

      if (destinationMarker) map.removeLayer(destinationMarker);
      destinationMarker = L.marker([lat, lon]).addTo(map)
        .bindPopup(`<b>${place.display_name}</b><br><button onclick="startRoute([${lat}, ${lon}])">Starta Rutt</button>`)
        .openPopup();
      map.setView([lat, lon], 14);
    })
    .catch((err) => {
      console.error("Nominatim fel:", err);
      toast("Fel vid sökning");
    });
}

// === Starta rutt ===
function startRoute(dest) {
  if (!userMarker) {
    toast("Ingen startposition");
    return;
  }
  const start = userMarker.getLatLng();

  if (selectedMode === "transit") {
    planTransitRoute(start, dest);
  } else {
    planOSRMRoute(start, dest, selectedMode);
  }
}

// === OSRM-rutt (bil/cykel/gång) ===
function planOSRMRoute(start, dest, mode) {
  const url = `${window.APP_CONFIG.osrm}/route/v1/${mode}/${start.lng},${start.lat};${dest[1]},${dest[0]}?overview=full&geometries=geojson&steps=true&annotations=maxspeed`;

  fetch(url)
    .then((r) => r.json())
    .then((data) => {
      if (!data.routes || !data.routes.length) return toast("Ingen rutt hittades");
      const route = data.routes[0];

      if (routeLayer) map.removeLayer(routeLayer);
      routeLayer = L.geoJSON(route.geometry, { color: "blue", weight: 5 }).addTo(map);
      map.fitBounds(routeLayer.getBounds());

      directions = route.legs[0].steps.map((s) => s.maneuver.instruction);
      currentStep = 0;
      updateDirectionsUI();
      speakDirection(directions[currentStep]);
    })
    .catch((err) => {
      console.error("OSRM fel:", err);
      toast("Kunde inte planera rutt");
    });
}

// === ResRobot-rutt (kollektivtrafik) ===
function planTransitRoute(start, dest) {
  const url = `${window.APP_CONFIG.resrobot.apiUrl}/trip.json?key=${window.APP_CONFIG.resrobot.apiKey}&originCoordLat=${start.lat}&originCoordLong=${start.lng}&destCoordLat=${dest[0]}&destCoordLong=${dest[1]}&format=json`;

  fetch(url)
    .then((r) => r.json())
    .then((data) => {
      if (!data.Trip || !data.Trip.length) return toast("Ingen kollektivtrafikresa hittades");

      const trip = data.Trip[0];
      directions = [];

      trip.Leg.forEach((leg) => {
        if (leg.type === "WALK") {
          directions.push(`Gå till ${leg.Origin.name}`);
        } else {
          directions.push(`${leg.name} från ${leg.Origin.name} → ${leg.Destination.name}`);
        }
      });

      currentStep = 0;
      updateDirectionsUI();
      speakDirection(directions[currentStep]);
    })
    .catch((err) => {
      console.error("ResRobot fel:", err);
      toast("Kunde inte planera kollektivtrafikresa");
    });
}

// === Navigering steg ===
function nextStep() {
  if (currentStep < directions.length - 1) {
    currentStep++;
    updateDirectionsUI();
    speakDirection(directions[currentStep]);
  }
}
function prevStep() {
  if (currentStep > 0) {
    currentStep--;
    updateDirectionsUI();
    speakDirection(directions[currentStep]);
  }
}

// === Avbryt rutt ===
function cancelRoute() {
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  if (destinationMarker) {
    map.removeLayer(destinationMarker);
    destinationMarker = null;
  }
  directions = [];
  document.getElementById("directionsList").innerText = "Ingen rutt aktiv.";
  document.getElementById("turnControls").classList.add("hidden");
}

// === Uppdatera UI ===
function updateDirectionsUI() {
  const list = document.getElementById("directionsList");
  if (!directions.length) {
    list.innerText = "Ingen rutt aktiv.";
    return;
  }
  list.innerHTML = `
    <div><b>Steg ${currentStep + 1}/${directions.length}</b>: ${directions[currentStep]}</div>
    <div class="next-step">${directions[currentStep + 1] || "Målet nått"}</div>
  `;
  document.getElementById("turnControls").classList.remove("hidden");
}

// === TTS ===
function speakDirection(text) {
  if (!("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "sv-SE";
  speechSynthesis.speak(utter);
}

// === Inställningar ===
function saveSettings() {
  const lang = document.getElementById("settingLanguage").value;
  const theme = document.getElementById("settingTheme").value;
  const uiPos = document.getElementById("settingUiPos").value;
  const transport = document.getElementById("settingTransport").value;

  localStorage.setItem("language", lang);
  localStorage.setItem("theme", theme);
  localStorage.setItem("uiPos", uiPos);
  localStorage.setItem("transportMode", transport);

  toast("Inställningar sparade");
  document.getElementById("settingsModal").classList.add("hidden");

  if (theme === "dark") {
    map.removeLayer(map._layersControl.light);
    map._layersControl.dark.addTo(map);
  } else {
    map.removeLayer(map._layersControl.dark);
    map._layersControl.light.addTo(map);
  }
}
function restoreSettings() {
  const transport = localStorage.getItem("transportMode");
  if (transport) selectedMode = transport;
}

// === Hjälpfunktioner ===
function toast(msg) {
  const el = document.getElementById("toast");
  el.innerText = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3000);
}
