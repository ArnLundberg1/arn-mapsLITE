// =====================
// Initiera kartan
// =====================
let map = L.map("map").setView([59.3293, 18.0686], 13);

let lightLayer = L.tileLayer(APP_CONFIG.map.tiles.light, {
  attribution: APP_CONFIG.map.attribution
}).addTo(map);

let darkLayer = L.tileLayer(APP_CONFIG.map.tiles.dark, {
  attribution: APP_CONFIG.map.attribution
});

let currentTheme = "light";

// =====================
// Globala variabler
// =====================
let userMarker, destinationMarker, routeLine;
let routeSteps = [];
let currentStepIndex = 0;
let followUser = false;

// =====================
// Hjälpfunktioner
// =====================
function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 3000);
}

function clearRoute() {
  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }
  if (destinationMarker) {
    map.removeLayer(destinationMarker);
    destinationMarker = null;
  }
  routeSteps = [];
  currentStepIndex = 0;
  document.getElementById("directionsList").innerHTML = "Ingen rutt aktiv.";
  document.getElementById("turnControls").classList.add("hidden");
}

// =====================
// GPS-positionering
// =====================
map.locate({ setView: true, watch: true });
map.on("locationfound", (e) => {
  if (!userMarker) {
    userMarker = L.marker(e.latlng).addTo(map).bindPopup("Du är här");
  } else {
    userMarker.setLatLng(e.latlng);
  }
  if (followUser) {
    map.setView(e.latlng, 16);
  }
});

map.on("locationerror", () => {
  alert("Kunde inte hitta position. Tillåt platsåtkomst.");
});

// =====================
// Sökning
// =====================
document.getElementById("searchBtn").addEventListener("click", () => {
  const q = document.getElementById("searchInput").value;
  if (!q) return;

  fetch(`${APP_CONFIG.nominatim}?q=${encodeURIComponent(q)}&format=json&limit=1`)
    .then(res => res.json())
    .then(data => {
      if (data.length > 0) {
        const place = data[0];
        const latlng = [place.lat, place.lon];
        if (destinationMarker) map.removeLayer(destinationMarker);
        destinationMarker = L.marker(latlng).addTo(map).bindPopup(`
          <b>${place.display_name}</b><br>
          <button id="startRouteBtn">Starta rutt</button>
        `).openPopup();

        setTimeout(() => {
          const btn = document.getElementById("startRouteBtn");
          if (btn) {
            btn.addEventListener("click", () => {
              if (userMarker) {
                startRoute(userMarker.getLatLng(), latlng);
              } else {
                showToast("Ingen startposition.");
              }
            });
          }
        }, 300);
      } else {
        showToast("Inga träffar.");
      }
    });
});

// =====================
// Routing
// =====================
function startRoute(start, end) {
  const mode = document.getElementById("settingMode")?.value || "driving";
  const url = `${APP_CONFIG.osrm}/route/v1/${mode}/${start.lng},${start.lat};${end[1]},${end[0]}?overview=full&geometries=geojson&steps=true&annotations=maxspeed`;

  fetch(url)
    .then(res => res.json())
    .then(data => {
      if (!data.routes || data.routes.length === 0) {
        showToast("Ingen rutt hittades.");
        return;
      }
      const route = data.routes[0];
      if (routeLine) map.removeLayer(routeLine);
      routeLine = L.geoJSON(route.geometry, { color: "blue" }).addTo(map);
      map.fitBounds(routeLine.getBounds());

      routeSteps = route.legs[0].steps;
      currentStepIndex = 0;
      updateDirectionsUI();

      document.getElementById("turnControls").classList.remove("hidden");
    });
}

function updateDirectionsUI() {
  const list = document.getElementById("directionsList");
  list.innerHTML = "";

  if (routeSteps.length === 0) return;

  const stepsToShow = routeSteps.slice(currentStepIndex, currentStepIndex + 2);
  stepsToShow.forEach(step => {
    const li = document.createElement("div");
    li.innerHTML = `➡️ ${step.maneuver.instruction}`;
    list.appendChild(li);
  });

  if ("speechSynthesis" in window) {
    const utterance = new SpeechSynthesisUtterance(stepsToShow[0].maneuver.instruction);
    speechSynthesis.speak(utterance);
  }
}

document.getElementById("btnNextStep").addEventListener("click", () => {
  if (currentStepIndex < routeSteps.length - 1) {
    currentStepIndex++;
    updateDirectionsUI();
  }
});

document.getElementById("btnPrevStep").addEventListener("click", () => {
  if (currentStepIndex > 0) {
    currentStepIndex--;
    updateDirectionsUI();
  }
});

document.getElementById("btnCancelRoute").addEventListener("click", clearRoute);

// =====================
// Trafikverket API
// =====================
async function loadTraffic() {
  try {
    const res = await fetch(`${APP_CONFIG.trafikverket.apiUrl}?key=${APP_CONFIG.trafikverket.apiKey}`);
    const data = await res.json();
    data.messages?.forEach(ev => {
      L.marker([ev.lat, ev.lon], { icon: L.divIcon({ className: "traffic-warning", html: "⚠️" }) })
        .addTo(map)
        .bindPopup(ev.title || "Trafikhändelse");
    });
  } catch (err) {
    console.error("Trafikverket API fel:", err);
  }
}
loadTraffic();

// =====================
// Inställningar-popup
// =====================
const settingsModal = document.getElementById("settingsModal");
document.getElementById("btnSettings").addEventListener("click", () => {
  settingsModal.classList.remove("hidden");
});
document.getElementById("closeSettings").addEventListener("click", () => {
  settingsModal.classList.add("hidden");
});
document.getElementById("saveSettingsBtn").addEventListener("click", () => {
  const lang = document.getElementById("settingLanguage").value;
  const theme = document.getElementById("settingTheme").value;

  if (theme !== currentTheme) {
    if (theme === "dark") {
      map.removeLayer(lightLayer);
      map.addLayer(darkLayer);
    } else {
      map.removeLayer(darkLayer);
      map.addLayer(lightLayer);
    }
    currentTheme = theme;
  }
  settingsModal.classList.add("hidden");
  showToast("Inställningar sparade.");
});

// =====================
// Recenter-knapp
// =====================
document.getElementById("btnLocate").addEventListener("click", () => {
  if (userMarker) {
    map.setView(userMarker.getLatLng(), 16);
  } else {
    map.locate({ setView: true });
  }
});
