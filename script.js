/* script.js — Navigation med Leaflet, OSRM, ResRobot, Trafikverket, TTS */

/* ---------- CONFIG ---------- */
const CONFIG = window.APP_CONFIG || {};

/* ---------- GLOBALS ---------- */
let map, lightLayer, darkLayer;
let userMarker = null;
let followMode = true;
let currentTheme = 'light';
let routeGeoLayer = null;
let destinationMarker = null;
let currentRoute = null;
let visibleTurnIndex = 0;
let turnWindowSize = 2;
let transportMode = localStorage.getItem("transportMode") || "driving"; // default bil
let recentSearches = JSON.parse(localStorage.getItem("recentSearches") || "[]");
let favorites = JSON.parse(localStorage.getItem("favorites") || "[]");
let ttsEnabled = true;

/* ---------- UTIL ---------- */
function toast(msg, ms = 3000) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), ms);
}

function saveState() {
  localStorage.setItem("recentSearches", JSON.stringify(recentSearches.slice(0, 20)));
  localStorage.setItem("favorites", JSON.stringify(favorites));
}

/* ---------- INIT ---------- */
function initApp() {
  const tileLight = CONFIG.map?.tiles?.light || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileDark = CONFIG.map?.tiles?.dark || "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
  const attr = CONFIG.map?.attribution || "";

  map = L.map("map", { zoomControl: false }).setView([59.3293, 18.0686], 13);
  lightLayer = L.tileLayer(tileLight, { attribution: attr });
  darkLayer = L.tileLayer(tileDark, { attribution: attr });

  if (currentTheme === "light") {
    lightLayer.addTo(map);
  } else {
    darkLayer.addTo(map);
  }

  L.control.zoom({ position: "bottomright" }).addTo(map);

  startGeolocation();
  renderRecents();
  renderFavorites();
  bindUI();
}

/* ---------- GEOLOCATION ---------- */
function startGeolocation() {
  if (!navigator.geolocation) {
    toast("GPS stöds inte i din webbläsare");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      updateUserPosition(pos.coords.latitude, pos.coords.longitude);
    },
    (err) => {
      console.warn("Geo error", err);
      toast("Kunde inte hämta position");
    },
    { enableHighAccuracy: true }
  );
  navigator.geolocation.watchPosition(
    (pos) => {
      updateUserPosition(pos.coords.latitude, pos.coords.longitude);
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 1000 }
  );
}

function updateUserPosition(lat, lng) {
  if (!userMarker) {
    userMarker = L.circleMarker([lat, lng], {
      radius: 8,
      fillColor: "#007bff",
      color: "#fff",
      weight: 2,
    }).addTo(map).bindPopup("Du är här");
    if (followMode) map.setView([lat, lng], 15);
  } else {
    userMarker.setLatLng([lat, lng]);
    if (followMode) map.panTo([lat, lng]);
  }
}

/* ---------- UI BINDINGS ---------- */
function bindUI() {
  document.getElementById("searchBtn").addEventListener("click", () => {
    const q = document.getElementById("searchInput").value.trim();
    if (q) performSearch(q);
  });

  document.getElementById("searchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("searchBtn").click();
  });

  // transport
  document.querySelectorAll("#transportButtons .mode").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#transportButtons .mode").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      transportMode = btn.dataset.mode;
      localStorage.setItem("transportMode", transportMode);
    });
  });

  // settings
  document.getElementById("btnSettings").addEventListener("click", () => toggleSettings(true));
  document.getElementById("closeSettings").addEventListener("click", () => toggleSettings(false));
  document.getElementById("saveSettingsBtn").addEventListener("click", () => saveSettingsFromModal());
}

/* ---------- SEARCH ---------- */
function performSearch(q) {
  const url = `${CONFIG.nominatim}?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=5`;
  fetch(url)
    .then((r) => r.json())
    .then((results) => {
      if (!results || !results.length) {
        toast("Inga resultat");
        return;
      }
      const r0 = results[0];
      addDestination(parseFloat(r0.lat), parseFloat(r0.lon), r0.display_name);
      recentSearches = [q].concat(recentSearches.filter((x) => x !== q)).slice(0, 10);
      renderRecents();
      saveState();
    })
    .catch((err) => {
      console.error("Search error", err);
      toast("Sökfel");
    });
}

function renderRecents() {
  const el = document.getElementById("recentList");
  el.innerHTML = "";
  recentSearches.forEach((s) => {
    const li = document.createElement("li");
    li.textContent = s;
    li.onclick = () => {
      document.getElementById("searchInput").value = s;
      performSearch(s);
    };
    el.appendChild(li);
  });
}

/* ---------- DESTINATION ---------- */
function addDestination(lat, lon, name) {
  if (destinationMarker) map.removeLayer(destinationMarker);
  destinationMarker = L.marker([lat, lon], { title: name }).addTo(map);
  destinationMarker.bindPopup(`
    <div><b>${name}</b><br>
      <button onclick="startRoute(${lat},${lon})">🚀 Starta rutt</button>
      <button onclick="clearRoute()">❌ Avbryt</button>
    </div>`).openPopup();
  map.panTo([lat, lon]);
}

/* ---------- ROUTING ---------- */
function startRoute(destLat, destLon) {
  if (!userMarker) {
    toast("Position saknas");
    return;
  }
  const start = userMarker.getLatLng();

  if (transportMode === "transit") {
    // ResRobot (kollektivtrafik)
    const url = `${CONFIG.resrobot.apiUrl}?key=${CONFIG.resrobot.apiKey}&originCoordLat=${start.lat}&originCoordLong=${start.lng}&destCoordLat=${destLat}&destCoordLong=${destLon}&format=json`;
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (!j.Trip || !j.Trip.length) {
          toast("Ingen kollektivtrafikresa hittades");
          return;
        }
        currentRoute = j.Trip[0];
        document.getElementById("directionsList").innerHTML = j.Trip[0].LegList.Leg.map(
          (leg) => `<div>${leg.Origin.name} → ${leg.Destination.name} (${leg.type})</div>`
        ).join("");
      })
      .catch((err) => {
        console.error("Transit error", err);
        toast("Fel vid ResRobot");
      });
  } else {
    // OSRM (bil/cykel/gång)
    const profile = transportMode === "cycling" ? "bike" : transportMode === "walking" ? "foot" : "car";
    const url = `${CONFIG.osrm}/route/v1/${profile}/${start.lng},${start.lat};${destLon},${destLat}?overview=full&geometries=geojson&steps=true`;
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (!j.routes || !j.routes.length) {
          toast("Ingen rutt hittades");
          return;
        }
        currentRoute = j.routes[0];
        if (routeGeoLayer) map.removeLayer(routeGeoLayer);
        routeGeoLayer = L.geoJSON(currentRoute.geometry, { style: { color: "#2b7ae4", weight: 6 } }).addTo(map);
        map.fitBounds(routeGeoLayer.getBounds());

        map._navSteps = currentRoute.legs.flatMap((leg) => leg.steps);
        visibleTurnIndex = 0;
        renderVisibleTurns();
      })
      .catch((err) => {
        console.error("OSRM error", err);
        toast("Fel vid ruttplanering");
      });
  }
}

/* ---------- DIRECTIONS ---------- */
function renderVisibleTurns() {
  const container = document.getElementById("directionsList");
  container.innerHTML = "";
  const steps = map._navSteps || [];
  if (!steps.length) {
    container.innerHTML = "Ingen rutt aktiv.";
    return;
  }
  for (let i = 0; i < turnWindowSize; i++) {
    const s = steps[visibleTurnIndex + i];
    if (!s) break;
    container.innerHTML += `<div class="turnStep">
      <div>${s.maneuver?.instruction || s.name || "Fortsätt rakt fram"}</div>
      <div>${Math.round(s.distance)} m</div>
    </div>`;
  }
}

/* ---------- CLEAR ROUTE ---------- */
function clearRoute() {
  if (routeGeoLayer) map.removeLayer(routeGeoLayer);
  if (destinationMarker) map.removeLayer(destinationMarker);
  routeGeoLayer = null;
  destinationMarker = null;
  map._navSteps = [];
  currentRoute = null;
  document.getElementById("directionsList").innerHTML = "Ingen rutt aktiv.";
}

/* ---------- FAVORITES ---------- */
function renderFavorites() {
  const el = document.getElementById("favList");
  el.innerHTML = "";
  favorites.forEach((f) => {
    const li = document.createElement("li");
    li.textContent = f.name;
    li.onclick = () => addDestination(f.lat, f.lon, f.name);
    el.appendChild(li);
  });
}

/* ---------- SETTINGS ---------- */
function toggleSettings(show) {
  const m = document.getElementById("settingsModal");
  if (show) {
    m.classList.remove("hidden");
    document.getElementById("settingLanguage").value = localStorage.getItem("appLang") || "sv";
    document.getElementById("settingTheme").value = currentTheme;
    document.getElementById("settingTransport").value = transportMode;
  } else {
    m.classList.add("hidden");
  }
}

function saveSettingsFromModal() {
  const lang = document.getElementById("settingLanguage").value;
  const theme = document.getElementById("settingTheme").value;
  const mode = document.getElementById("settingTransport").value;

  localStorage.setItem("appLang", lang);
  localStorage.setItem("transportMode", mode);
  setTheme(theme);
  transportMode = mode;

  toast("Inställningar sparade");
  toggleSettings(false);
}

/* ---------- THEME ---------- */
function setTheme(t) {
  if (t === "dark") {
    if (map.hasLayer(lightLayer)) map.removeLayer(lightLayer);
    if (!map.hasLayer(darkLayer)) map.addLayer(darkLayer);
    currentTheme = "dark";
  } else {
    if (map.hasLayer(darkLayer)) map.removeLayer(darkLayer);
    if (!map.hasLayer(lightLayer)) map.addLayer(lightLayer);
    currentTheme = "light";
  }
}

/* ---------- INIT ---------- */
document.addEventListener("DOMContentLoaded", () => {
  initApp();
});
