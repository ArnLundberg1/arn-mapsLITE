/* script.js — Navigation med OSRM, Nominatim, Trafikverket, m.m. */

/* ---------- GLOBAL CONFIG ---------- */
const CONFIG = window.APP_CONFIG || {};

/* ---------- GLOBALS ---------- */
let map, lightLayer, darkLayer;
let userMarker = null;
let destinationMarker = null;
let routeGeoLayer = null;
let currentRoute = null;
let visibleTurnIndex = 0;
let turnWindowSize = 2;
let transportMode = localStorage.getItem("transportMode") || "driving"; // default bil
let currentTheme = localStorage.getItem("theme") || "light";
let ttsEnabled = true;

/* ---------- INIT ---------- */
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  bindUI();
});

/* ---------- MAP ---------- */
function initMap() {
  const tileLight = CONFIG.map?.tiles?.light || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileDark = CONFIG.map?.tiles?.dark || "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
  const attr = CONFIG.map?.attribution || "";

  map = L.map("map", { zoomControl: false }).setView([59.3293, 18.0686], 13);
  lightLayer = L.tileLayer(tileLight, { attribution: attr });
  darkLayer = L.tileLayer(tileDark, { attribution: attr });

  if (currentTheme === "light") lightLayer.addTo(map);
  else darkLayer.addTo(map);

  L.control.zoom({ position: "bottomright" }).addTo(map);

  startGeolocation();
}

/* ---------- POSITION ---------- */
function startGeolocation() {
  if (!navigator.geolocation) {
    toast("GPS stöds inte");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => updateUserPosition(pos.coords.latitude, pos.coords.longitude),
    err => console.warn("Geolocation fel:", err),
    { enableHighAccuracy: true }
  );
  navigator.geolocation.watchPosition(
    pos => updateUserPosition(pos.coords.latitude, pos.coords.longitude),
    () => {},
    { enableHighAccuracy: true, maximumAge: 1000 }
  );
}

function updateUserPosition(lat, lon) {
  if (!userMarker) {
    userMarker = L.circleMarker([lat, lon], {
      radius: 8,
      fillColor: "#007bff",
      color: "#fff",
      weight: 2
    }).addTo(map);
    map.setView([lat, lon], 15);
  } else {
    userMarker.setLatLng([lat, lon]);
  }
}

/* ---------- UI ---------- */
function bindUI() {
  document.getElementById("searchBtn").addEventListener("click", () => {
    const q = document.getElementById("searchInput").value.trim();
    if (q) performSearch(q);
  });

  document.getElementById("btnSettings").addEventListener("click", () => toggleSettings(true));
  document.getElementById("closeSettings").addEventListener("click", () => toggleSettings(false));
  document.getElementById("saveSettingsBtn").addEventListener("click", saveSettingsFromModal);

  document.getElementById("btnNextStep").addEventListener("click", () => advanceTurns(1));
  document.getElementById("btnPrevStep").addEventListener("click", () => advanceTurns(-1));
  document.getElementById("btnCancelRoute").addEventListener("click", clearRoute);
}

/* ---------- SEARCH ---------- */
function performSearch(q) {
  const url = `${CONFIG.nominatim}?q=${encodeURIComponent(q)}&format=json&limit=1`;
  fetch(url)
    .then(r => r.json())
    .then(results => {
      if (!results || !results.length) {
        toast("Inga resultat");
        return;
      }
      const r0 = results[0];
      addDestination(parseFloat(r0.lat), parseFloat(r0.lon), r0.display_name);
    })
    .catch(() => toast("Sökfel"));
}

/* ---------- DESTINATION ---------- */
function addDestination(lat, lon, name) {
  if (destinationMarker) {
    map.removeLayer(destinationMarker);
  }
  destinationMarker = L.marker([lat, lon]).addTo(map);
  destinationMarker.bindPopup(
    `<b>${name}</b><br>
     <button onclick="startRoute(${lat},${lon})">🚀 Starta rutt</button>`
  ).openPopup();
}

/* ---------- ROUTING ---------- */
function startRoute(destLat, destLon) {
  if (!userMarker) {
    toast("Ingen startposition");
    return;
  }
  const start = userMarker.getLatLng();
  const profile = transportMode === "driving" ? "car" : transportMode === "cycling" ? "bike" : "foot";

  const url = `${CONFIG.osrm}/route/v1/${profile}/${start.lng},${start.lat};${destLon},${destLat}?overview=full&geometries=geojson&steps=true`;

  fetch(url)
    .then(r => r.json())
    .then(j => {
      if (!j.routes?.length) {
        toast("Ingen rutt hittades");
        return;
      }
      currentRoute = j.routes[0];

      if (routeGeoLayer) map.removeLayer(routeGeoLayer);
      routeGeoLayer = L.geoJSON(currentRoute.geometry, { style: { color: "#2b7ae4", weight: 6 } }).addTo(map);
      map.fitBounds(routeGeoLayer.getBounds());

      const steps = [];
      currentRoute.legs.forEach(leg => leg.steps.forEach(s => steps.push(s)));
      map._navSteps = steps;
      visibleTurnIndex = 0;

      renderVisibleTurns();
      document.getElementById("turnControls").classList.remove("hidden");
    })
    .catch(err => {
      console.error("Routingfel:", err);
      toast("Routingfel");
    });
}

/* ---------- INSTRUCTION FORMATTER ---------- */
function formatInstruction(step) {
  if (step.maneuver?.instruction) return step.maneuver.instruction;
  if (step.maneuver?.type) {
    return step.maneuver.type + (step.maneuver.modifier ? " " + step.maneuver.modifier : "");
  }
  if (step.name) return "Följ " + step.name;
  return "Fortsätt rakt fram";
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
      <div>${formatInstruction(s)}</div>
      <div>${Math.round(s.distance)} m</div>
    </div>`;
  }
}

function advanceTurns(delta) {
  const steps = map._navSteps || [];
  if (!steps.length) return;
  visibleTurnIndex += delta;
  if (visibleTurnIndex < 0) visibleTurnIndex = 0;
  if (visibleTurnIndex > steps.length - turnWindowSize) visibleTurnIndex = steps.length - turnWindowSize;
  renderVisibleTurns();
}

function clearRoute() {
  if (routeGeoLayer) map.removeLayer(routeGeoLayer);
  if (destinationMarker) map.removeLayer(destinationMarker);
  document.getElementById("directionsList").innerHTML = "Ingen rutt aktiv.";
  document.getElementById("turnControls").classList.add("hidden");
  currentRoute = null;
}

/* ---------- SETTINGS ---------- */
function toggleSettings(show) {
  const m = document.getElementById("settingsModal");
  if (show) {
    m.classList.remove("hidden");
    document.getElementById("settingTheme").value = currentTheme;
    document.getElementById("settingTransport").value = transportMode;
  } else {
    m.classList.add("hidden");
  }
}

function saveSettingsFromModal() {
  currentTheme = document.getElementById("settingTheme").value;
  transportMode = document.getElementById("settingTransport").value;
  localStorage.setItem("theme", currentTheme);
  localStorage.setItem("transportMode", transportMode);
  setTheme(currentTheme);
  toggleSettings(false);
  toast("Inställningar sparade");
}

/* ---------- THEME ---------- */
function setTheme(t) {
  if (t === "dark") {
    if (map.hasLayer(lightLayer)) map.removeLayer(lightLayer);
    if (!map.hasLayer(darkLayer)) map.addLayer(darkLayer);
  } else {
    if (map.hasLayer(darkLayer)) map.removeLayer(darkLayer);
    if (!map.hasLayer(lightLayer)) map.addLayer(lightLayer);
  }
}

/* ---------- TOAST ---------- */
function toast(msg, ms = 3000) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), ms);
}
