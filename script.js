./* script.js — komplett klientlogik (Leaflet + OSRM + ResRobot + inställningar + TTS) */

/* ----------------- CONFIG ----------------- */
const CONFIG = window.APP_CONFIG || {};

/* ----------------- GLOBALS ----------------- */
let map;
let lightLayer, darkLayer;
let userMarker = null;
let destinationMarker = null;
let routeLayer = null;
let watchId = null;

let navSteps = [];           // steg (från OSRM eller ResRobot-omvandling)
let visibleTurnIndex = 0;
const TURN_WINDOW = 2;

let ttsEnabled = true;

// Defaults / settings (load from localStorage or default)
let settings = {
  language: localStorage.getItem("language") || "sv",           // 'sv' | 'en'
  theme: localStorage.getItem("theme") || "light",             // 'light' | 'dark'
  mode: localStorage.getItem("mode") || "driving",             // 'driving'|'cycling'|'walking'|'public_transport'
  follow: localStorage.getItem("follow") === "true" || false,
  mobile: localStorage.getItem("mobile") === "true" || false,
  // ResRobot parameters (for transit)
  transit_products: localStorage.getItem("transit_products") || "511",   // 64 = buss
  transit_maxwalk: parseInt(localStorage.getItem("transit_maxwalk") || "200", 10)
};

/* ----------------- TRANSLATIONS ----------------- */
const I18N = {
  sv: {
    you_are_here: "Du är här",
    location_error: "Kunde inte hämta din position.",
    ask_permission: "Webbplatsen behöver din plats för navigering. Tillåt position?",
    no_route: "Ingen rutt hittades.",
    no_place: "Ingen plats hittades.",
    search_error: "Fel vid sökning.",
    routing_error: "Fel vid ruttberäkning.",
    resrobot_error: "Kunde inte planera kollektivtrafikresa.",
    directions_title: "Vägbeskrivning",
    turn_left: "Sväng vänster om {dist}",
    turn_right: "Sväng höger om {dist}",
    continue: "Fortsätt rakt fram om {dist}",
    start_route: "Starta rutt",
    cancel_route: "Avbryt rutt",
    saved_settings: "Inställningar sparade"
  },
  en: {
    you_are_here: "You are here",
    location_error: "Could not fetch your position.",
    ask_permission: "The site needs your location for navigation. Allow location?",
    no_route: "No route found.",
    no_place: "No place found.",
    search_error: "Search failed.",
    routing_error: "Routing failed.",
    resrobot_error: "Could not plan transit trip.",
    directions_title: "Directions",
    turn_left: "Turn left in {dist}",
    turn_right: "Turn right in {dist}",
    continue: "Continue straight in {dist}",
    start_route: "Start route",
    cancel_route: "Cancel route",
    saved_settings: "Settings saved"
  }
};

function L18(key, vars = {}) {
  const lang = settings.language || "sv";
  let s = (I18N[lang] && I18N[lang][key]) || key;
  for (const k in vars) s = s.replace(`{${k}}`, vars[k]);
  return s;
}

/* ----------------- INIT APP ----------------- */
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  applyTheme(settings.theme);
  applyMobile(settings.mobile);
  bindUI();
  startGeolocation();   // starta geolocation (med watch)
});

/* ----------------- MAP ----------------- */
function initMap() {
  map = L.map("map", { zoomControl: true }).setView([59.3293, 18.0686], 13);

  const tileLight = CONFIG.map?.tiles?.light || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileDark  = CONFIG.map?.tiles?.dark  || "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
  const attr = CONFIG.map?.attribution || "";

  lightLayer = L.tileLayer(tileLight, { attribution: attr });
  darkLayer  = L.tileLayer(tileDark,  { attribution: attr });

  (settings.theme === "dark" ? darkLayer : lightLayer).addTo(map);

  L.control.zoom({ position: "bottomright" }).addTo(map);

  // ensure directions box hidden until route
  const db = document.getElementById("directionsBox");
  if (db) db.style.display = "none";
}

/* ----------------- GEOLOCATION ----------------- */
function startGeolocation() {
  if (!navigator.geolocation) {
    alert(L18("location_error"));
    return;
  }

  // Try quick one-shot first (to trigger permission prompt)
  navigator.geolocation.getCurrentPosition(
    pos => {
      updateUserPosition(pos.coords.latitude, pos.coords.longitude);
      // then start watch
      startWatch();
    },
    err => {
      // show a friendly prompt to ask permission again
      requestPermissionAndWatch();
    },
    { enableHighAccuracy: true, timeout: 7000 }
  );
}

function startWatch() {
  if (watchId !== null) return; // already watching
  watchId = navigator.geolocation.watchPosition(
    pos => updateUserPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.speed),
    err => {
      console.warn("watchPosition error:", err);
      // If error (denied/unavailable), ask again after short delay
      setTimeout(requestPermissionAndWatch, 3000);
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
  );
}

function requestPermissionAndWatch() {
  // Show a confirm dialog to the user to re-try permission
  if (confirm(L18("ask_permission"))) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        updateUserPosition(pos.coords.latitude, pos.coords.longitude);
        startWatch();
      },
      err => {
        alert(L18("location_error"));
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  } else {
    toast(L18("location_error"));
  }
}

function updateUserPosition(lat, lon, speed) {
  const latlng = [lat, lon];
  if (!userMarker) {
    userMarker = L.marker(latlng).addTo(map).bindPopup(L18("you_are_here"));
    if (settings.follow) map.setView(latlng, 15);
  } else {
    userMarker.setLatLng(latlng);
    if (settings.follow) map.panTo(latlng);
  }

  // optional: show speed/hints etc.
  // speed is in m/s; convert to km/h if needed
}

/* ----------------- UI BINDING ----------------- */
function bindUI() {
  // Search
  const searchBtn = document.getElementById("searchBtn");
  const searchInput = document.getElementById("searchInput");
  if (searchBtn) searchBtn.addEventListener("click", () => { const q = searchInput.value.trim(); if (q) performSearch(q); });
  if (searchInput) searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { const q = searchInput.value.trim(); if (q) performSearch(q); } });

  // Cancel route
  const cancelBtn = document.getElementById("cancelRouteBtn");
  if (cancelBtn) cancelBtn.addEventListener("click", () => cancelRoute());

  // Settings open/close (index.html uses onclick too — ensure functions global)
  // Save settings: index.html calls saveSettings() inline, but define it here too
  // Directions box initially hidden
  const db = document.getElementById("directionsBox");
  if (db) db.style.display = "none";
}

/* ----------------- SEARCH (Nominatim) ----------------- */
async function performSearch(query) {
  try {
    // Nominatim: use configured endpoint (can be with or without /search)
    const base = CONFIG.nominatim || "https://nominatim.openstreetmap.org/search";
    const sep = base.includes("?") ? "&" : "?";
    const url = `${base}${sep}q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1&accept-language=${settings.language}`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const results = await res.json();
    if (!results || results.length === 0) {
      alert(L18("no_place"));
      return;
    }
    // show first result, but you could show list
    const r0 = results[0];
    const lat = parseFloat(r0.lat), lon = parseFloat(r0.lon);
    const name = r0.display_name || (r0.address && Object.values(r0.address).slice(0,3).join(", "));
    showDestinationMarker(lat, lon, name);
  } catch (err) {
    console.error("Search error:", err);
    alert(L18("search_error"));
  }
}

function showDestinationMarker(lat, lon, name) {
  if (destinationMarker) map.removeLayer(destinationMarker);
  destinationMarker = L.marker([lat, lon]).addTo(map);

  // Build popup with Starta rutt button (calls global startRoute)
  const popupHtml = `<div style="max-width:260px"><b>${escapeHtml(name)}</b><div style="margin-top:8px">
      <button onclick="startRoute(${lat}, ${lon})">${L18("start_route")}</button>
      <button onclick="cancelRoute()" style="margin-left:8px">${L18("cancel_route")}</button>
    </div></div>`;
  destinationMarker.bindPopup(popupHtml).openPopup();
  map.panTo([lat, lon]);
}

/* small helper to escape HTML in names */
function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"'`=\/]/g, function(s){ return '&#' + s.charCodeAt(0) + ';'; });
}

/* ----------------- ROUTING ENTRYPOINT ----------------- */
/* startRoute(lat, lon) is called inline from popup and must be global */
function startRoute(destLat, destLon) {
  if (!userMarker) {
    // ask permission & try again
    requestPermissionAndWatch();
    toast(L18("location_error"));
    return;
  }

  const mode = settings.mode || "driving";
  if (mode === "public_transport" || mode === "transit") {
    planResRobotRoute(destLat, destLon);
  } else {
    planOSRMRoute(destLat, destLon, mode);
  }
}

/* ----------------- OSRM ROUTING ----------------- */
async function planOSRMRoute(destLat, destLon, mode) {
  try {
    const start = userMarker.getLatLng();
    // map mode mapping for OSRM profile
    // some OSRM servers expect 'car' or 'driving' -> our config.osrm likely supports 'car'/'bike'/'foot'
    let profile = "car";
    if (mode === "cycling" || mode === "bike") profile = "bike";
    else if (mode === "walking" || mode === "foot") profile = "foot";

    const base = CONFIG.osrm || "https://router.project-osrm.org";
    const url = `${base}/route/v1/${profile}/${start.lng},${start.lat};${destLon},${destLat}?overview=full&geometries=geojson&steps=true&annotations=true&language=${settings.language === "sv" ? "sv" : "en"}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error("OSRM HTTP " + res.status);
    const j = await res.json();
    if (!j.routes || j.routes.length === 0) {
      alert(L18("no_route"));
      return;
    }

    currentRouteToMap(j.routes[0]);
  } catch (err) {
    console.error("OSRM error:", err);
    alert(L18("routing_error"));
  }
}

function currentRouteToMap(routeObj) {
  // remove previous
  if (routeLayer) map.removeLayer(routeLayer);
  // Draw route
  if (routeObj.geometry) {
    routeLayer = L.geoJSON(routeObj.geometry, { style: { color: "#2b7ae4", weight: 6, opacity:0.9 } }).addTo(map);
    // fit bounds
    try { map.fitBounds(routeLayer.getBounds(), { padding: [40,40] }); } catch(e){ /* ignore */ }
  } else if (routeObj.geometry && routeObj.geometry.coordinates) {
    // fallback: convert coords
    const coords = routeObj.geometry.coordinates.map(c => [c[1], c[0]]);
    routeLayer = L.polyline(coords, { color: "#2b7ae4", weight: 6 }).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [40,40] });
  }

  // flatten legs->steps
  navSteps = [];
  (routeObj.legs || []).forEach(leg => {
    (leg.steps || []).forEach(s => navSteps.push(s));
  });
  visibleTurnIndex = 0;
  renderVisibleTurns();
  showDirectionsPanel(true);

  // speak first visible turns
  speakVisibleTurns();
}

/* ----------------- RESROBOT (Transit) ----------------- */
async function planResRobotRoute(destLat, destLon) {
  try {
    const start = userMarker.getLatLng();
    if (!CONFIG.resrobot || !CONFIG.resrobot.apiKey) {
      alert("ResRobot-nyckel saknas i config.");
      return;
    }

    // Build ResRobot URL — support both base that includes /trip or not
    // Use transit parameters from settings (products + maxWalkDist)
    const base = CONFIG.resrobot.apiUrl || "https://api.resrobot.se/v2.1/trip";
    const sep = base.includes("?") ? "&" : "?";
    const params = [
      `originCoordLat=${start.lat}`,
      `originCoordLong=${start.lng}`,
      `destCoordLat=${destLat}`,
      `destCoordLong=${destLon}`,
      `products=${encodeURIComponent(settings.transit_products)}`,
      `maxWalkDist=${encodeURIComponent(settings.transit_maxwalk)}`,
      `format=json`,
      `accessId=${encodeURIComponent(CONFIG.resrobot.apiKey)}`,
      `key=${encodeURIComponent(CONFIG.resrobot.apiKey)}`
    ];
    const url = base + sep + params.join("&");

    const res = await fetch(url);
    if (!res.ok) throw new Error("ResRobot HTTP " + res.status);
    const data = await res.json();
    if (!data.Trip || data.Trip.length === 0) {
      alert(L18("no_route"));
      return;
    }

    // Convert ResRobot Trip into navSteps (simple textual steps)
    const trip = data.Trip[0];
    navSteps = []; // each step: { maneuver: { instruction }, distance? }
    // Trip.LegList.Leg or Trip.Leg might be returned depending on API version — try robustly
    const legs = trip.Leg || trip.LegList?.Leg || [];
    // legs may be array or object
    const legArray = Array.isArray(legs) ? legs : (legs ? [legs] : []);
    legArray.forEach(leg => {
      // If walking leg
      if (String(leg.type).toUpperCase().includes("WALK")) {
        const dist = leg.dist || leg.distance || 0;
        navSteps.push({
          maneuver: { instruction: generateTransitWalkText(leg, settings.language) },
          distance: dist
        });
      } else {
        // transit leg e.g. bus/tram/train
        const name = leg.name || leg.product || leg.type || "Fordon";
        const origin = leg.Origin?.name || (leg.Origin && (leg.Origin.name || "")) || "";
        const dest = leg.Destination?.name || "";
        navSteps.push({
          maneuver: { instruction: `${name} från ${origin} → ${dest}` },
          distance: leg.dist || 0
        });
      }
    });

    // plot simple polyline from stop coordinates if available
    const coords = [];
    legArray.forEach(leg => {
      if (leg.Origin?.lat && leg.Origin?.lon) coords.push([parseFloat(leg.Origin.lat), parseFloat(leg.Origin.lon)]);
      if (leg.Destination?.lat && leg.Destination?.lon) coords.push([parseFloat(leg.Destination.lat), parseFloat(leg.Destination.lon)]);
    });
    if (coords.length > 0) {
      if (routeLayer) map.removeLayer(routeLayer);
      routeLayer = L.polyline(coords, { color: "#1e90ff", weight: 5 }).addTo(map);
      try { map.fitBounds(routeLayer.getBounds(), { padding: [40,40] }); } catch(e){}
    }

    visibleTurnIndex = 0;
    renderVisibleTurns();
    showDirectionsPanel(true);
    speakVisibleTurns();
  } catch (err) {
    console.error("ResRobot error:", err);
    alert(L18("resrobot_error"));
  }
}

function generateTransitWalkText(leg, lang) {
  // leg may contain distance/time info
  const dist = leg.dist ? Math.round(leg.dist) + " m" : "";
  if (lang === "sv") {
    if (dist) return `Gå ${dist}`;
    return `Gå`;
  } else {
    if (dist) return `Walk ${dist}`;
    return `Walk`;
  }
}

/* ----------------- DIRECTIONS UI ----------------- */
function renderVisibleTurns() {
  const container = document.getElementById("directionsList");
  if (!container) return;
  container.innerHTML = "";

  if (!navSteps || navSteps.length === 0) {
    container.innerHTML = ""; // keep empty when no route
    return;
  }

  // clamp visibleTurnIndex
  if (visibleTurnIndex < 0) visibleTurnIndex = 0;
  if (visibleTurnIndex > Math.max(0, navSteps.length - TURN_WINDOW)) visibleTurnIndex = Math.max(0, navSteps.length - TURN_WINDOW);

  for (let i = 0; i < TURN_WINDOW; i++) {
    const idx = visibleTurnIndex + i;
    if (idx >= navSteps.length) break;
    const s = navSteps[idx];
    const text = formatStepText(s);
    const distText = s.distance ? ` <span class="meta">(${Math.round(s.distance)} m)</span>` : "";
    container.innerHTML += `<div class="turnStep">${escapeHtml(text)}${distText}</div>`;
  }
}

/* natural-language formatter for a single step object */
function formatStepText(step) {
  // step might be OSRM step (with maneuver) or our ResRobot-converted step
  const lang = settings.language || "sv";

  // If step has maneuver.instruction already, try to parse/convert into "<action> in X meters"
  const instr = step.maneuver?.instruction || step.maneuver?.text || step.maneuver?.type || step.maneuver?.modifier || step.maneuver?.name || null;
  const dist = step.distance ? Math.round(step.distance) : null;

  // If maneuver contains modifier/type fields (OSRM), prefer them for natural phrasing
  if (step.maneuver && (step.maneuver.modifier || step.maneuver.type)) {
    const mod = step.maneuver.modifier || step.maneuver.type;
    // map common modifiers to phrases
    let action;
    if (lang === "sv") {
      if (mod === "left") action = "Sväng vänster";
      else if (mod === "right") action = "Sväng höger";
      else if (mod === "straight") action = "Fortsätt rakt fram";
      else action = capitalizeFirst(mod);
      if (dist) return `${action} om ${dist} meter`;
      return action;
    } else {
      if (mod === "left") action = "Turn left";
      else if (mod === "right") action = "Turn right";
      else if (mod === "straight") action = "Continue straight";
      else action = capitalizeFirst(mod);
      if (dist) return `${action} in ${dist} meters`;
      return action;
    }
  }

  // If we already have a fairly complete instruction string (ResRobot or OSRM), try to make it natural
  if (instr && typeof instr === "string" && instr.length > 0) {
    // Attempt to detect "turn" keywords already present — if contains numbers/units, keep
    if (dist) {
      // If instr already contains distance words, just return instr
      if (instr.match(/\b(meter|m|meters|metres|km|kilometer)\b/i)) return instr;
      // else attach distance naturally
      if (settings.language === "sv") return `${capitalizeFirst(instr)} om ${dist} meter`;
      else return `${capitalizeFirst(instr)} in ${dist} meters`;
    }
    return capitalizeFirst(instr);
  }

  // fallback generic
  if (settings.language === "sv") return "Fortsätt";
  return "Continue";
}

function capitalizeFirst(s) {
  if (!s || typeof s !== "string") return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* show/hide directions panel */
function showDirectionsPanel(show) {
  const el = document.getElementById("directionsBox");
  if (!el) return;
  el.style.display = show ? "block" : "none";
}

/* next/prev controls (if you wire them in UI) */
function nextTurns() {
  if (!navSteps || navSteps.length === 0) return;
  visibleTurnIndex = Math.min(visibleTurnIndex + TURN_WINDOW, navSteps.length - TURN_WINDOW);
  renderVisibleTurns();
  speakVisibleTurns();
}
function prevTurns() {
  if (!navSteps || navSteps.length === 0) return;
  visibleTurnIndex = Math.max(visibleTurnIndex - TURN_WINDOW, 0);
  renderVisibleTurns();
  speakVisibleTurns();
}

/* clear route */
function cancelRoute() {
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  if (destinationMarker) {
    map.removeLayer(destinationMarker);
    destinationMarker = null;
  }
  navSteps = [];
  visibleTurnIndex = 0;
  renderVisibleTurns();
  showDirectionsPanel(false);
}

/* ----------------- TTS ----------------- */
function speakVisibleTurns() {
  if (!ttsEnabled || !("speechSynthesis" in window)) return;
  const stepsWindow = (navSteps || []).slice(visibleTurnIndex, visibleTurnIndex + TURN_WINDOW);
  if (!stepsWindow.length) return;
  const langCode = settings.language === "sv" ? "sv-SE" : "en-US";
  const text = stepsWindow.map(s => formatStepText(s)).join(". ");
  if (!text) return;
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = langCode;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utt);
}

/* ----------------- SETTINGS ----------------- */
/* these are used by index.html (which has onclick="openSettings()" etc.) */
function openSettings() {
  const popup = document.getElementById("settingsPopup");
  if (!popup) return;
  // populate fields with current settings
  const sLang = document.getElementById("langSelect");
  const sTheme = document.getElementById("themeSelect");
  const sMode = document.getElementById("modeSelect");
  const sFollow = document.getElementById("followToggle");
  const sMobile = document.getElementById("mobileToggle");
  const sTransProducts = document.getElementById("transitProducts"); // optional element
  const sTransMaxWalk = document.getElementById("transitMaxWalk"); // optional element

  if (sLang) sLang.value = settings.language;
  if (sTheme) sTheme.value = settings.theme;
  if (sMode) sMode.value = settings.mode;
  if (sFollow) sFollow.checked = settings.follow;
  if (sMobile) sMobile.checked = settings.mobile;
  if (sTransProducts) sTransProducts.value = settings.transit_products;
  if (sTransMaxWalk) sTransMaxWalk.value = settings.transit_maxwalk;

  popup.style.display = "block";
}
function closeSettings() {
  const popup = document.getElementById("settingsPopup");
  if (!popup) return;
  popup.style.display = "none";
}
function saveSettings() {
  // Read values from DOM (index.html must have elements with these ids)
  const sLang = document.getElementById("langSelect");
  const sTheme = document.getElementById("themeSelect");
  const sMode = document.getElementById("modeSelect");
  const sFollow = document.getElementById("followToggle");
  const sMobile = document.getElementById("mobileToggle");
  const sTransProducts = document.getElementById("transitProducts");
  const sTransMaxWalk = document.getElementById("transitMaxWalk");

  settings.language = sLang ? sLang.value : settings.language;
  settings.theme = sTheme ? sTheme.value : settings.theme;
  settings.mode = sMode ? sMode.value : settings.mode;
  settings.follow = sFollow ? sFollow.checked : settings.follow;
  settings.mobile = sMobile ? sMobile.checked : settings.mobile;
  if (sTransProducts && sTransProducts.value) settings.transit_products = sTransProducts.value;
  if (sTransMaxWalk && sTransMaxWalk.value) settings.transit_maxwalk = parseInt(sTransMaxWalk.value, 10) || settings.transit_maxwalk;

  // persist
  localStorage.setItem("language", settings.language);
  localStorage.setItem("theme", settings.theme);
  localStorage.setItem("mode", settings.mode);
  localStorage.setItem("follow", settings.follow);
  localStorage.setItem("mobile", settings.mobile);
  localStorage.setItem("transit_products", settings.transit_products);
  localStorage.setItem("transit_maxwalk", settings.transit_maxwalk);

  // apply immediately
  applyTheme(settings.theme);
  applyMobile(settings.mobile);
  // ensure follow behavior used
  // if user turned follow on and we have user position, center map
  if (settings.follow && userMarker) map.setView(userMarker.getLatLng());

  // feedback
  toast(L18("saved_settings"));
  closeSettings();
}

/* ----------------- APPLY THEME / MOBILE ----------------- */
function applyTheme(theme) {
  if (!map) return;
  settings.theme = theme;
  if (theme === "dark") {
    if (map.hasLayer(lightLayer)) map.removeLayer(lightLayer);
    if (!map.hasLayer(darkLayer)) darkLayer.addTo(map);
    document.body.classList.add("dark");
  } else {
    if (map.hasLayer(darkLayer)) map.removeLayer(darkLayer);
    if (!map.hasLayer(lightLayer)) lightLayer.addTo(map);
    document.body.classList.remove("dark");
  }
}
function applyMobile(mobile) {
  settings.mobile = mobile;
  if (mobile) document.body.classList.add("mobile");
  else document.body.classList.remove("mobile");
}

/* ----------------- UTIL & UI ----------------- */
function toast(msg, ms = 3000) {
  // simple visual transient message — try to find #toast element else alert
  const el = document.getElementById("toast");
  if (el) {
    el.textContent = msg;
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), ms);
  } else {
    console.log("TOAST:", msg);
  }
}

/* escape HTML helper (already defined above) */
function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"'`=\/]/g, function(s){ return '&#' + s.charCodeAt(0) + ';'; });
}

/* ----------------- Add global functions used inline in HTML ----------------- */
// make these global so inline onclick works
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.saveSettings = saveSettings;
window.startRoute = startRoute;
window.cancelRoute = cancelRoute;
window.nextTurns = nextTurns;
window.prevTurns = prevTurns;

/* End of script.js */
