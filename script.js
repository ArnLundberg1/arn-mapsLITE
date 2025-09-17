// Initiera karta
const map = L.map("map").setView([59.3293, 18.0686], 13);
let currentTheme = "light";

// Lager
const lightLayer = L.tileLayer(window.APP_CONFIG.map.tiles.light, {
  attribution: window.APP_CONFIG.map.attribution
});
const darkLayer = L.tileLayer(window.APP_CONFIG.map.tiles.dark, {
  attribution: window.APP_CONFIG.map.attribution
});
lightLayer.addTo(map);

// Markörer och variabler
let userMarker, destMarker, routeLayer;
let followMode = true;
let currentRoute = null;
let currentStepIndex = 0;

// Geolocation
if (navigator.geolocation) {
  navigator.geolocation.watchPosition(
    (pos) => {
      const latlng = [pos.coords.latitude, pos.coords.longitude];
      if (!userMarker) {
        userMarker = L.marker(latlng).addTo(map).bindPopup("Du är här");
        map.setView(latlng, 15);
      } else {
        userMarker.setLatLng(latlng);
      }
      if (followMode) map.setView(latlng);
    },
    (err) => {
      showToast("Kunde inte hämta plats. Tillåt platsåtkomst.");
    },
    { enableHighAccuracy: true }
  );
}

// Sök
document.getElementById("searchBtn").addEventListener("click", () => {
  const query = document.getElementById("searchInput").value;
  if (!query) return;

  fetch(`${window.APP_CONFIG.nominatim}?q=${encodeURIComponent(query)}&format=json&limit=1`)
    .then(res => res.json())
    .then(data => {
      if (data.length > 0) {
        const { lat, lon, display_name } = data[0];
        const latlng = [parseFloat(lat), parseFloat(lon)];
        if (destMarker) map.removeLayer(destMarker);
        destMarker = L.marker(latlng).addTo(map).bindPopup(`
          <b>${display_name}</b><br>
          <button onclick="startRoute([${lat}, ${lon}])">Starta rutt</button>
        `).openPopup();
        map.setView(latlng, 14);
        addRecentSearch(display_name);
      } else {
        showToast("Ingen plats hittades");
      }
    })
    .catch(() => showToast("Sökfel"));
});

// Ruttplanering
function startRoute(dest) {
  if (!userMarker) {
    showToast("Ingen startposition");
    return;
  }

  const start = userMarker.getLatLng();
  const mode = document.getElementById("settingMode").value;

  let profile = "driving";
  if (mode === "cycling") profile = "cycling";
  if (mode === "walking") profile = "walking";
  if (mode === "transit") profile = "driving"; // placeholder

  const url = `${window.APP_CONFIG.osrm}/route/v1/${profile}/${start.lng},${start.lat};${dest[1]},${dest[0]}?steps=true&geometries=geojson`;

  fetch(url)
    .then(res => res.json())
    .then(data => {
      if (!data.routes || !data.routes.length) {
        showToast("Ingen rutt hittades");
        return;
      }
      if (routeLayer) map.removeLayer(routeLayer);

      currentRoute = data.routes[0];
      routeLayer = L.geoJSON(currentRoute.geometry).addTo(map);
      currentStepIndex = 0;
      updateDirections();
      document.getElementById("turnControls").classList.remove("hidden");
    })
    .catch(() => showToast("Fel vid ruttberäkning"));
}

// Uppdatera vägbeskrivning
function updateDirections() {
  if (!currentRoute) return;
  const steps = currentRoute.legs[0].steps;
  const panel = document.getElementById("directionsList");
  panel.innerHTML = "";

  const shownSteps = steps.slice(currentStepIndex, currentStepIndex + 2);
  shownSteps.forEach((s, i) => {
    const div = document.createElement("div");
    div.innerHTML = `${s.maneuver.instruction}`;
    panel.appendChild(div);
  });

  // TTS
  const msg = new SpeechSynthesisUtterance(shownSteps[0].maneuver.instruction);
  speechSynthesis.speak(msg);
}

// Nästa/föregående steg
document.getElementById("btnNextStep").addEventListener("click", () => {
  if (!currentRoute) return;
  if (currentStepIndex < currentRoute.legs[0].steps.length - 1) {
    currentStepIndex++;
    updateDirections();
  }
});
document.getElementById("btnPrevStep").addEventListener("click", () => {
  if (!currentRoute) return;
  if (currentStepIndex > 0) {
    currentStepIndex--;
    updateDirections();
  }
});

// Avbryt rutt
document.getElementById("btnCancelRoute").addEventListener("click", () => {
  if (routeLayer) map.removeLayer(routeLayer);
  routeLayer = null;
  currentRoute = null;
  document.getElementById("directionsList").innerHTML = "Ingen rutt aktiv.";
  document.getElementById("turnControls").classList.add("hidden");
  if (destMarker) map.removeLayer(destMarker);
  destMarker = null;
});

// Favoriter & senaste sökningar
function addRecentSearch(name) {
  const list = document.getElementById("recentList");
  const li = document.createElement("li");
  li.textContent = name;
  list.prepend(li);
}
document.getElementById("saveHome").addEventListener("click", () => saveFavorite("Hem"));
document.getElementById("saveWork").addEventListener("click", () => saveFavorite("Jobb"));

function saveFavorite(label) {
  if (!userMarker) return;
  const { lat, lng } = userMarker.getLatLng();
  const list = document.getElementById("favList");
  const li = document.createElement("li");
  li.textContent = `${label}: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  list.appendChild(li);
}

// Inställningar
const settingsModal = document.getElementById("settingsModal");
document.getElementById("btnSettings").addEventListener("click", () => {
  settingsModal.classList.remove("hidden");
});
document.getElementById("closeSettings").addEventListener("click", () => {
  settingsModal.classList.add("hidden");
});
document.getElementById("saveSettingsBtn").addEventListener("click", () => {
  const theme = document.getElementById("settingTheme").value;
  if (theme !== currentTheme) {
    map.removeLayer(theme === "light" ? darkLayer : lightLayer);
    (theme === "light" ? lightLayer : darkLayer).addTo(map);
    currentTheme = theme;
  }
  settingsModal.classList.add("hidden");
});

// API integrationer
async function loadTraffic() {
  try {
    const res = await fetch(window.APP_CONFIG.trafikverket.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body: `<REQUEST>
        <LOGIN authenticationkey="${window.APP_CONFIG.trafikverket.apiKey}" />
        <QUERY objecttype="Situation" schemaversion="1"/>
      </REQUEST>`
    });
    const data = await res.json();
    console.log("Trafikverket data", data);
  } catch (err) {
    console.warn("Kunde inte hämta Trafikverket", err);
  }
}

async function loadWeather() {
  try {
    const res = await fetch(window.APP_CONFIG.weather.apiUrl);
    const data = await res.json();
    console.log("SMHI varningar", data);
  } catch (err) {
    console.warn("Kunde inte hämta SMHI", err);
  }
}

// Toast
function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 4000);
}
