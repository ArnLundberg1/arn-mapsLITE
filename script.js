/* script.js – komplett logik (kartor, rutter, UI, TTS, Trafikverket, etc.) */

/* ---------- CONFIG (från config.cfg) ---------- */
const CONFIG = window.APP_CONFIG || {};

/* ---------- GLOBALS ---------- */
let map, lightLayer, darkLayer;
let userMarker = null;
let followMode = true;
let currentTheme = "light";
let destinationMarker = null;
let routeGeoLayer = null;
let currentRoute = null;
let visibleTurnIndex = 0;
let transportMode = localStorage.getItem("transportMode") || "driving"; // standard bil
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
  localStorage.setItem("transportMode", transportMode);
}

/* ---------- INIT MAP ---------- */
function initApp() {
  const tileLight = CONFIG.map?.tiles?.light || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileDark = CONFIG.map?.tiles?.dark || "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
  const attr = CONFIG.map?.attribution || "&copy; OpenStreetMap contributors";

  map = L.map("map", { zoomControl: false }).setView([59.3293, 18.0686], 13);

  lightLayer = L.tileLayer(tileLight, { attribution: attr });
  darkLayer = L.tileLayer(tileDark, { attribution: attr });

  (currentTheme === "light" ? lightLayer : darkLayer).addTo(map);

  L.control.zoom({ position: "bottomright" }).addTo(map);

  startGeolocation();
  renderRecents();
  renderFavorites();
  bindUI();

  if (CONFIG.trafikverket?.apiKey) loadTrafficIncidents();
  if (CONFIG.charging?.apiUrl) loadChargingStations();
  if (CONFIG.parking?.apiUrl) loadParking();
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
    () => toast("Kunde inte hämta position"),
    { enableHighAccuracy: true }
  );
  navigator.geolocation.watchPosition(
    (pos) => updateUserPosition(pos.coords.latitude, pos.coords.longitude),
    (err) => console.warn("GPS-fel", err),
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
    })
      .addTo(map)
      .bindPopup("Du är här");
    if (followMode) map.setView([lat, lng], 15);
  } else {
    userMarker.setLatLng([lat, lng]);
    if (followMode) map.panTo([lat, lng]);
  }
}

/* ---------- UI ---------- */
function bindUI() {
  document.getElementById("searchBtn").addEventListener("click", () => {
    const q = document.getElementById("searchInput").value.trim();
    if (q) performSearch(q);
  });
  document.getElementById("searchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("searchBtn").click();
  });

  document.querySelectorAll("#transportButtons .mode").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#transportButtons .mode").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      transportMode = btn.dataset.mode;
      saveState();
    });
  });

  document.getElementById("btnLocate").addEventListener("click", () => {
    if (userMarker) map.panTo(userMarker.getLatLng());
  });

  document.getElementById("btnSettings").addEventListener("click", () => toggleSettings(true));
  document.getElementById("closeSettings").addEventListener("click", () => toggleSettings(false));
  document.getElementById("saveSettingsBtn").addEventListener("click", () => saveSettingsFromModal());
}

/* ---------- SEARCH (Nominatim) ---------- */
function performSearch(q) {
  const url = `${CONFIG.nominatim}?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1&accept-language=sv`;
  fetch(url, { headers: { Accept: "application/json" } })
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then((results) => {
      if (!results.length) return toast("Ingen plats hittad");
      const r0 = results[0];
      addDestination(parseFloat(r0.lat), parseFloat(r0.lon), r0.display_name);
      recentSearches = [q].concat(recentSearches.filter((x) => x !== q)).slice(0, 10);
      renderRecents();
      saveState();
    })
    .catch((err) => {
      console.error("Sökfel:", err);
      toast("Fel vid sökning");
    });
}

function renderRecents() {
  const el = document.getElementById("recentList");
  el.innerHTML = "";
  recentSearches.forEach((s) => {
    const li = document.createElement("li");
    li.textContent = s;
    li.style.cursor = "pointer";
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
  destinationMarker.bindPopup(
    `<b>${name}</b><br><button onclick="startRoute(${lat},${lon})">🚀 Starta rutt</button>`
  ).openPopup();
  map.panTo([lat, lon]);
}

/* ---------- ROUTING ---------- */
function startRoute(destLat, destLon) {
  if (!userMarker) return toast("Behöver din position");
  const start = userMarker.getLatLng();
  let profile =
    transportMode === "driving"
      ? "car"
      : transportMode === "cycling"
      ? "bike"
      : transportMode === "walking"
      ? "foot"
      : "car";

  const base = CONFIG.osrm || "https://router.project-osrm.org";
  const url = `${base}/route/v1/${profile}/${start.lng},${start.lat};${destLon},${destLat}?overview=full&geometries=geojson&steps=true`;

  fetch(url)
    .then((r) => r.json())
    .then((j) => {
      if (!j.routes || !j.routes.length) return toast("Ingen rutt hittades");
      currentRoute = j.routes[0];
      if (routeGeoLayer) map.removeLayer(routeGeoLayer);
      routeGeoLayer = L.geoJSON(currentRoute.geometry, { style: { color: "#2b7ae4", weight: 6 } }).addTo(map);
      map.fitBounds(routeGeoLayer.getBounds(), { padding: [40, 40] });
      toast("Rutt klar!");
    })
    .catch((err) => {
      console.error("Routing error:", err);
      toast("Routingfel");
    });
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

/* ---------- SETTINGS MODAL ---------- */
function toggleSettings(show) {
  const m = document.getElementById("settingsModal");
  if (show) m.classList.remove("hidden");
  else m.classList.add("hidden");
  if (show) {
    document.getElementById("settingLanguage").value = localStorage.getItem("appLang") || "sv";
    document.getElementById("settingTheme").value = currentTheme;
    document.getElementById("settingTransport").value = transportMode;
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
  toggleSettings(false);
  toast("Inställningar sparade");
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

/* ---------- TRAFIKVERKET ---------- */
function loadTrafficIncidents() {
  const req = `<REQUEST><LOGIN authenticationkey='${CONFIG.trafikverket.apiKey}' /><QUERY objecttype='Situation'></QUERY></REQUEST>`;
  fetch(CONFIG.trafikverket.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: req,
  })
    .then((r) => r.json())
    .then((j) => {
      const situations = j.RESPONSE?.RESULT?.[0]?.Situation || [];
      situations.forEach((s) => {
        const msg = s.Message || "Trafikhändelse";
        if (s.Geometry && typeof s.Geometry === "string") {
          const m = s.Geometry.match(/POINT \(([-\d\.]+) ([-\d\.]+)\)/);
          if (m) {
            const lon = parseFloat(m[1]),
              lat = parseFloat(m[2]);
            L.circleMarker([lat, lon], { radius: 7, color: "#e74c3c" })
              .addTo(map)
              .bindPopup(`<b>Trafik</b><br>${msg}`);
          }
        }
      });
    })
    .catch((err) => console.error("Trafikverket fel:", err));
}

/* ---------- CHARGING STATIONS ---------- */
function loadChargingStations() {
  if (!CONFIG.charging?.apiUrl) return;
  const lat = userMarker?.getLatLng()?.lat || 59.3293;
  const lon = userMarker?.getLatLng()?.lng || 18.0686;
  const url = `${CONFIG.charging.apiUrl}?output=json&countrycode=SE&latitude=${lat}&longitude=${lon}&distance=10&maxresults=20`;
  fetch(url)
    .then((r) => r.json())
    .then((data) => {
      data.forEach((st) => {
        if (st.AddressInfo) {
          L.marker([st.AddressInfo.Latitude, st.AddressInfo.Longitude])
            .addTo(map)
            .bindPopup(`<b>Laddstation</b><br>${st.AddressInfo.Title}`);
        }
      });
    });
}

/* ---------- PARKING ---------- */
function loadParking() {
  if (!CONFIG.parking?.apiUrl) return;
  fetch(CONFIG.parking.apiUrl)
    .then((r) => r.json())
    .then((data) => {
      data.forEach((p) => {
        if (p.lat && p.lon) {
          L.marker([p.lat, p.lon]).addTo(map).bindPopup(`<b>Parkering</b><br>${p.name || ""}`);
        }
      });
    });
}

/* ---------- INIT ---------- */
document.addEventListener("DOMContentLoaded", () => {
  initApp();
});
