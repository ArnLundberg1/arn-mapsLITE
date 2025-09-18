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
    currentMarker = L.marker(e.latlng).addTo(map).bindPopup(t("you_are_here"));
  } else {
    currentMarker.setLatLng(e.latlng);
  }
  if (following) map.setView(e.latlng);
});

map.on("locationerror", () => {
  alert(t("location_error"));
  setTimeout(locateUser, 5000); // försök igen efter 5 sek
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

// ================= TRANSLATIONS =================
const translations = {
  sv: {
    start_route: "Starta rutt",
    cancel_route: "Avbryt rutt",
    you_are_here: "Du är här",
    location_error: "Kunde inte hämta din position.",
    no_route: "Ingen rutt hittades.",
    searching: "Söker...",
    no_place: "Ingen plats hittades.",
    turn_left: "Sväng vänster om {dist}",
    turn_right: "Sväng höger om {dist}",
    continue: "Fortsätt rakt fram om {dist}",
  },
  en: {
    start_route: "Start route",
    cancel_route: "Cancel route",
    you_are_here: "You are here",
    location_error: "Could not fetch your position.",
    no_route: "No route found.",
    searching: "Searching...",
    no_place: "No place found.",
    turn_left: "Turn left in {dist}",
    turn_right: "Turn right in {dist}",
    continue: "Continue straight in {dist}",
  }
};

function t(key, vars = {}) {
  const lang = localStorage.getItem("language") || "sv";
  let str = translations[lang][key] || key;
  for (let k in vars) {
    str = str.replace(`{${k}}`, vars[k]);
  }
  return str;
}

// ================= SEARCH =================
async function searchPlace(query) {
  try {
    const url = `${config.nominatim}?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.length) {
      alert(t("no_place"));
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
    <button onclick="startRoute([${latlng}], '${name}')">${t("start_route")}</button>
  `;
  destinationMarker.bindPopup(popupHtml).openPopup();
}

// ================= ROUTING =================
async function startRoute(latlng, name) {
  if (!currentMarker) {
    alert(t("location_error"));
    return;
  }

  const mode = localStorage.getItem("mode") || "driving";
  if (mode === "public_transport") {
    await planResRobot(latlng);
    return;
  }

  // OSRM
  const start = currentMarker.getLatLng();
  const url = `${config.osrm}/route/v1/${mode}/${start.lng},${start.lat};${latlng[1]},${latlng[0]}?overview=full&geometries=geojson&steps=true`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.routes?.length) {
      alert(t("no_route"));
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

// ================= RESROBOT ROUTING =================
async function planResRobot(latlng) {
  const start = currentMarker.getLatLng();
  const url = `${config.resrobot.apiUrl}?format=json&originCoordLat=${start.lat}&originCoordLong=${start.lng}&destCoordLat=${latlng[0]}&destCoordLong=${latlng[1]}&accessId=${config.resrobot.apiKey}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.Trip?.length) {
      alert(t("no_route"));
      return;
    }

    const trip = data.Trip[0];
    const coords = [];
    const steps = [];

    trip.LegList.Leg.forEach(leg => {
      if (leg.Origin && leg.Destination) {
        coords.push([leg.Origin.lat, leg.Origin.lon]);
        coords.push([leg.Destination.lat, leg.Destination.lon]);
        steps.push({ instruction: `${leg.name} → ${leg.Destination.name}`, distance: leg.dist });
      }
    });

    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.polyline(coords, { color: "blue" }).addTo(map);
    map.fitBounds(routeLayer.getBounds());

    map._navSteps = steps;
    visibleTurnIndex = 0;
    renderVisibleTurns();

    document.getElementById("directionsBox").style.display = "block";
  } catch (err) {
    alert("ResRobot-fel: " + err.message);
  }
}

// ================= CANCEL ROUTE =================
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
  if (step.maneuver) {
    const dist = step.distance ? Math.round(step.distance) + " m" : "";
    if (step.maneuver.modifier === "left") return t("turn_left", { dist });
    if (step.maneuver.modifier === "right") return t("turn_right", { dist });
    return t("continue", { dist });
  } else if (step.instruction) {
    return step.instruction;
  }
  return "...";
}

function renderVisibleTurns() {
  const container = document.getElementById("directionsList");
  container.innerHTML = "";
  const steps = map._navSteps || [];
  if (!steps.length) {
    container.innerHTML = "";
    return;
  }

  for (let i = 0; i < turnWindowSize; i++) {
    const s = steps[visibleTurnIndex + i];
    if (!s) break;
    container.innerHTML += `<div class="turnStep">${formatInstruction(s)}</div>`;
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
  const mobile = document.getElementById("mobileToggle").checked;

  localStorage.setItem("language", lang);
  localStorage.setItem("theme", theme);
  localStorage.setItem("mode", mode);
  localStorage.setItem("follow", follow);
  localStorage.setItem("mobile", mobile);

  setTheme(theme);
  following = follow;
  document.body.classList.toggle("mobile", mobile);

  closeSettings();
}

// ================= INIT UI EVENTS =================
document.getElementById("searchBtn").addEventListener("click", () => {
  const q = document.getElementById("searchInput").value;
  if (q) searchPlace(q);
});

document.getElementById("cancelRouteBtn").addEventListener("click", cancelRoute);

// ================= START =================
locateUser();
