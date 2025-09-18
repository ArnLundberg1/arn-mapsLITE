// ================= INIT CONFIG =================
const config = window.APP_CONFIG;

// ================= INIT MAP =================
let map = L.map("map", { zoomControl: true }).setView([59.3293, 18.0686], 13);
let currentMarker, routeLayer, destinationMarker;
let following = false;
let visibleTurnIndex = 0;
const turnWindowSize = 2;

// Tile layers
const lightTiles = L.tileLayer(config.map.tiles.light, { attribution: config.map.attribution });
const darkTiles = L.tileLayer(config.map.tiles.dark, { attribution: config.map.attribution });

// Load saved theme
const savedTheme = localStorage.getItem("theme") || "light";
if (savedTheme === "dark") darkTiles.addTo(map);
else lightTiles.addTo(map);

// ================= GPS POSITION =================
function locateUser() {
  map.locate({ setView: true, watch: true, enableHighAccuracy: true });
}

map.on("locationfound", e => {
  if (!currentMarker) {
    currentMarker = L.marker(e.latlng).addTo(map).bindPopup("Du är här");
  } else {
    currentMarker.setLatLng(e.latlng);
  }
  if (following) map.setView(e.latlng);
});

map.on("locationerror", () => {
  alert("Kunde inte hämta din position.");
});

// ================= THEME TOGGLE =================
function setTheme(theme) {
  if (theme === "dark") {
    map.removeLayer(lightTiles);
    darkTiles.addTo(map);
  } else {
    map.removeLayer(darkTiles);
    lightTiles.addTo(map);
  }
  localStorage.setItem("theme", theme);
}

// ================= SEARCH =================
async function searchPlace(query) {
  try {
    const url = `${config.nominatim}?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.length) {
      alert("Ingen plats hittades.");
      return;
    }
    const place = data[0];
    const latlng = [place.lat, place.lon];

    if (destinationMarker) map.removeLayer(destinationMarker);
    destinationMarker = L.marker(latlng).addTo(map).bindPopup(place.display_name).openPopup();
    map.setView(latlng, 14);

    showRoutePopup(latlng, place.display_name);
  } catch (err) {
    alert("Sökfel: " + err.message);
  }
}

function showRoutePopup(latlng, name) {
  const popupHtml = `
    <b>${name}</b><br>
    <button onclick="startRoute([${latlng}], '${name}')">Starta rutt</button>
  `;
  destinationMarker.bindPopup(popupHtml).openPopup();
}

// ================= ROUTING =================
async function startRoute(latlng, name) {
  if (!currentMarker) {
    alert("Ingen startposition hittades.");
    return;
  }

  const mode = localStorage.getItem("mode") || "driving";
  const start = currentMarker.getLatLng();
  const url = `${config.osrm}/route/v1/${mode}/${start.lng},${start.lat};${latlng[1]},${latlng[0]}?overview=full&geometries=geojson&steps=true&language=en`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.routes?.length) {
      alert("Ingen rutt hittades.");
      return;
    }

    const route = data.routes[0];
    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.geoJSON(route.geometry).addTo(map);
    map.fitBounds(routeLayer.getBounds());

    map._navSteps = route.legs[0].steps;
    visibleTurnIndex = 0;
    renderVisibleTurns();

    document.getElementById("directionsBox").style.display = "block";
  } catch (err) {
    alert("Kunde inte planera rutt: " + err.message);
  }
}

function cancelRoute() {
  if (routeLayer) map.removeLayer(routeLayer);
  routeLayer = null;
  map._navSteps = [];
  visibleTurnIndex = 0;
  renderVisibleTurns();
  if (destinationMarker) {
    map.removeLayer(destinationMarker);
    destinationMarker = null;
  }
  document.getElementById("directionsBox").style.display = "none";
}

// ================= INSTRUCTION FORMATTER =================
function formatInstruction(step) {
  const lang = localStorage.getItem("language") || "sv";
  const dist = step.distance ? Math.round(step.distance) + " meter" : "";

  let dir = "";
  if (step.maneuver?.modifier) {
    if (lang === "sv") {
      if (step.maneuver.modifier === "left") dir = "sväng vänster";
      else if (step.maneuver.modifier === "right") dir = "sväng höger";
      else if (step.maneuver.modifier === "straight") dir = "fortsätt rakt fram";
      else dir = "följ vägen";
    } else {
      if (step.maneuver.modifier === "left") dir = "turn left";
      else if (step.maneuver.modifier === "right") dir = "turn right";
      else if (step.maneuver.modifier === "straight") dir = "continue straight";
      else dir = "follow the road";
    }
  } else {
    dir = lang === "sv" ? "fortsätt" : "continue";
  }

  if (dist) {
    if (lang === "sv") return `${dir} om ${dist}`;
    else return `${dir} in ${dist}`;
  }
  return dir;
}

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
    container.innerHTML += `<div class="turnStep">${formatInstruction(s)}</div>`;
  }
}

function nextTurn() {
  if (map._navSteps && visibleTurnIndex < map._navSteps.length - 1) {
    visibleTurnIndex++;
    renderVisibleTurns();
  }
}
function prevTurn() {
  if (map._navSteps && visibleTurnIndex > 0) {
    visibleTurnIndex--;
    renderVisibleTurns();
  }
}

// ================= SETTINGS =================
function openSettings() {
  document.getElementById("settingsPopup").style.display = "block";
}
function closeSettings() {
  document.getElementById("settingsPopup").style.display = "none";
}
function saveSettings() {
  const lang = document.getElementById("langSelect").value;
  const theme = document.getElementById("themeSelect").value;
  const mode = document.getElementById("modeSelect").value;
  const follow = document.getElementById("followToggle").checked;

  localStorage.setItem("language", lang);
  localStorage.setItem("theme", theme);
  localStorage.setItem("mode", mode);
  localStorage.setItem("follow", follow);

  setTheme(theme);
  following = follow;

  closeSettings();
}

// ================= INIT UI EVENTS =================
document.getElementById("searchBtn").addEventListener("click", () => {
  const q = document.getElementById("searchInput").value;
  if (q) searchPlace(q);
});

document.getElementById("cancelRouteBtn").addEventListener("click", cancelRoute);
document.getElementById("nextBtn").addEventListener("click", nextTurn);
document.getElementById("prevBtn").addEventListener("click", prevTurn);

// ================= START =================
locateUser();
