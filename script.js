/* script.js — komplett klient-logik (Leaflet + routing + TTS + API hooks) */

/* ---------- CONFIG (från index.html) ---------- */
const CONFIG = window.APP_CONFIG || {};

/* ---------- GLOBALS ---------- */
let map, lightLayer, darkLayer;
let userMarker = null;
let followMode = true;
let currentTheme = 'light';
let routeControl = null;      // leaflet-routing-machine control (optional)
let routeGeoLayer = null;     // drawn geojson route
let destinationMarker = null;
let currentRoute = null;      // full route object
let visibleTurnIndex = 0;     // index into steps for turn-by-turn "window"
let turnWindowSize = 2;       // show only 2 steps at a time
let transportMode = 'driving'; // driving|cycling|walking|transit
let recentSearches = JSON.parse(localStorage.getItem('recentSearches')||'[]');
let favorites = JSON.parse(localStorage.getItem('favorites')||'[]');
let ttsEnabled = true;

/* ---------- UTIL ---------- */
function toast(msg, ms=3000){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(()=>t.classList.add('hidden'), ms);
}

function saveState(){
  localStorage.setItem('recentSearches', JSON.stringify(recentSearches.slice(0,20)));
  localStorage.setItem('favorites', JSON.stringify(favorites));
}

/* ---------- INIT MAP ---------- */
function initApp(){
  // init layers from CONFIG or fallbacks
  const tileLight = (CONFIG.map && CONFIG.map.tiles && CONFIG.map.tiles.light) || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const tileDark = (CONFIG.map && CONFIG.map.tiles && CONFIG.map.tiles.dark) || 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  const attr = (CONFIG.map && CONFIG.map.attribution) || '';

  map = L.map('map', { zoomControl:false }).setView([59.3293,18.0686],13);

  lightLayer = L.tileLayer(tileLight, { attribution: attr });
  darkLayer  = L.tileLayer(tileDark, { attribution: attr });

  if(currentTheme==='light'){ lightLayer.addTo(map); } else { darkLayer.addTo(map); }

  // Add zoom control bottom-right (Google-like)
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // request position: first try passive, then ask user explicitly if not found
  startGeolocation();

  // load UI state
  renderRecents();
  renderFavorites();

  // wire UI events
  bindUI();

  // if Trafikverket enabled, load incidents
  if(CONFIG.trafikverket && CONFIG.trafikverket.apiKey){
    loadTrafficIncidents();
  }

  // load POI layers (charging/parking) if toggled
  if(CONFIG.charging && CONFIG.charging.apiUrl) loadChargingStations();
  if(CONFIG.parking && CONFIG.parking.apiUrl) loadParking();

  // measure tool init placeholder
  initMeasureTool();
}

/* ---------- GEOLOCATION ---------- */
function startGeolocation(){
  if(!navigator.geolocation){
    toast("GPS stöds inte i din webbläsare");
    return;
  }

  // Try to get current position quickly (one shot)
  navigator.geolocation.getCurrentPosition(pos=>{
    updateUserPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.speed);
  }, err=>{
    // if denied or unavailable -> prompt explicitly with a dialog
    console.warn("Initial geolocation failed:", err);
    requestPermissionAndWatch();
  }, { enableHighAccuracy:true, timeout:5000 });

  // Also start watchPosition for live updates
  navigator.geolocation.watchPosition(pos=>{
    updateUserPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.speed);
  }, err=>{
    console.warn("watchPosition failed:", err);
  }, { enableHighAccuracy:true, maximumAge:1000 });
}

function requestPermissionAndWatch(){
  // Browser permission prompting is automatic via getCurrentPosition — call again with user-friendly toast
  if(confirm("Tillåt att sidan använder din position för navigering?")){
    navigator.geolocation.getCurrentPosition(pos=>{
      updateUserPosition(pos.coords.latitude,pos.coords.longitude,pos.coords.accuracy,pos.coords.speed);
    }, err=>{
      alert("Kunde inte få position: " + (err.message||err.code));
    }, { enableHighAccuracy:true });
  } else {
    toast("Position ej tillåten — vissa funktioner begränsade");
  }
}

function updateUserPosition(lat,lng,accuracy,speed){
  if(!userMarker){
    userMarker = L.circleMarker([lat,lng],{radius:8,fillColor:'#007bff',color:'#fff',weight:2}).addTo(map).bindPopup("Du är här");
    if(followMode) map.setView([lat,lng],15);
  } else {
    userMarker.setLatLng([lat,lng]);
    // if follow mode enabled keep camera on user
    if(followMode) map.panTo([lat,lng]);
  }

  // speed alerts (if available)
  if(speed && currentRoute && currentRoute.maxspeed){
    // speed is m/s, convert to km/h
    const kmh = speed*3.6;
    if(kmh > currentRoute.maxspeed + 2){
      toast(`Varning: du kör ${Math.round(kmh)} km/h (gräns ${currentRoute.maxspeed} km/h)`,4000);
    }
  }
}

/* ---------- UI BINDINGS ---------- */
function bindUI(){
  document.getElementById('searchBtn').addEventListener('click', ()=>{
    const q = document.getElementById('searchInput').value.trim();
    if(q) performSearch(q);
  });
  document.getElementById('searchInput').addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){ document.getElementById('searchBtn').click(); }
  });

  // transport mode toggles
  document.querySelectorAll('#transportButtons .mode').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('#transportButtons .mode').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      transportMode = btn.dataset.mode;
    });
  });

  // locate button
  document.getElementById('btnLocate').addEventListener('click', ()=>{
    if(userMarker) map.panTo(userMarker.getLatLng());
    else requestPermissionAndWatch();
  });

  // measure
  document.getElementById('btnMeasure').addEventListener('click', ()=>toggleMeasureMode());

  // settings modal
  document.getElementById('btnSettings').addEventListener('click', ()=>toggleSettings(true));
  document.getElementById('closeSettings').addEventListener('click', ()=>toggleSettings(false));
  document.getElementById('saveSettingsBtn').addEventListener('click', ()=>saveSettingsFromModal());
  // share
  document.getElementById('btnShare').addEventListener('click', shareView);

  // route controls
  document.getElementById('btnNextStep').addEventListener('click', ()=>advanceTurns(1));
  document.getElementById('btnPrevStep').addEventListener('click', ()=>advanceTurns(-1));
  document.getElementById('btnCancelRoute').addEventListener('click', ()=>clearRoute());

  // favorites quick save
  document.getElementById('saveHome').addEventListener('click', ()=>saveQuickFavorite('Hem'));
  document.getElementById('saveWork').addEventListener('click', ()=>saveQuickFavorite('Jobb'));

  // report button placeholder
  document.getElementById('btnReport').addEventListener('click', ()=>toast('Rapportera: välj typ i production'));
}

/* ---------- SEARCH (Nominatim) ---------- */
function performSearch(q){
  const url = `${(CONFIG.nominatim||'https://nominatim.openstreetmap.org/search')}?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=5`;
  fetch(url).then(r=>r.json()).then(results=>{
    if(!results || !results.length){ toast('Inga resultat'); return; }
    // put marker for first result and open popup with Starta rutt
    const r0 = results[0];
    const lat = parseFloat(r0.lat), lon = parseFloat(r0.lon);
    const name = r0.display_name;
    addDestination(lat,lon,name);
    // update recent searches
    recentSearches = [q].concat(recentSearches.filter(x=>x!==q)).slice(0,10);
    renderRecents();
    saveState();
  }).catch(err=>{
    console.error('Search error',err);
    toast('Sökfel');
  });
}

function renderRecents(){
  const el = document.getElementById('recentList'); el.innerHTML='';
  recentSearches.forEach(s=>{
    const li = document.createElement('li'); li.textContent=s;
    li.style.cursor='pointer';
    li.onclick = ()=>{ document.getElementById('searchInput').value=s; performSearch(s); };
    el.appendChild(li);
  });
}

/* ---------- DESTINATION / POPUP / START ROUTE ---------- */
function addDestination(lat,lon,name){
  // clear existing destination marker
  if(destinationMarker){ map.removeLayer(destinationMarker); destinationMarker=null; }
  destinationMarker = L.marker([lat,lon], { title:name }).addTo(map);
  // popup content uses inline onclick to call startRoute (safe here)
  const popupHtml = `<div style="max-width:260px"><b>${name}</b><div style="margin-top:8px">
    <button onclick="startRoute(${lat},${lon})">🚀 Starta rutt</button>
    <button onclick="clearRoute()" style="margin-left:8px">❌ Avbryt</button>
  </div></div>`;
  destinationMarker.bindPopup(popupHtml).openPopup();
  // when popup closed by user -> clear marker & route
  destinationMarker.on('popupclose', ()=>{ clearRoute(); });
  map.panTo([lat,lon]);
}

/* ---------- ROUTING via OSRM ---------- */
function startRoute(destLat,destLon){
  // ensure we have current pos
  if(!userMarker){
    // ask user to allow position
    if(confirm("Din position saknas. Vill du ge tillåtelse nu?")){
      requestPermissionAndWatch();
    } else {
      toast("Behöver position för rutt.");
      return;
    }
  }
  const start = userMarker.getLatLng();
  if(!start) { toast('Position saknas'); return; }

  // prepare profile
  let profile = (transportMode==='driving'?'car': transportMode==='cycling'?'bike': transportMode==='walking'?'foot':'car');

  // OSRM public (overview full & steps)
  const base = (CONFIG.osrm || 'https://router.project-osrm.org') + '/route/v1';
  const url = `${base}/${profile}/${start.lng},${start.lat};${destLon},${destLat}?overview=full&geometries=geojson&steps=true&annotations=maxspeed`;

  fetch(url).then(r=>r.json()).then(j=>{
    if(!j.routes || !j.routes.length){ toast('Inga rutter hittades'); return; }
    currentRoute = j.routes[0];

    // clear old
    if(routeGeoLayer) map.removeLayer(routeGeoLayer);
    routeGeoLayer = L.geoJSON(currentRoute.geometry, { style:{color:'#2b7ae4',weight:6,opacity:0.9} }).addTo(map);
    map.fitBounds(routeGeoLayer.getBounds(), { padding:[40,40] });

    // prepare turn-by-turn steps flattening legs->steps
    const steps = [];
    currentRoute.legs.forEach(leg=>{
      leg.steps.forEach(s=>steps.push(s));
    });
    // store steps for progression
    map._navSteps = steps;
    visibleTurnIndex = 0;
    renderVisibleTurns();

    // TTS: speak first visible steps
    speakVisibleTurns();

    // show turn controls
    document.getElementById('turnControls').classList.remove('hidden');
  }).catch(err=>{
    console.error('Routing error',err);
    toast('Routingfel');
  });
}

/* Show only a window of steps (2 at a time). Update when prev/next */
function renderVisibleTurns(){
  const container = document.getElementById('directionsList');
  container.innerHTML = '';
  const steps = map._navSteps || [];
  if(steps.length===0){ container.innerHTML = 'Ingen rutt aktiv.'; return; }

  // clamp index
  if(visibleTurnIndex < 0) visibleTurnIndex = 0;
  if(visibleTurnIndex > Math.max(0, steps.length-turnWindowSize)) visibleTurnIndex = Math.max(0, steps.length-turnWindowSize);

  const frag = document.createDocumentFragment();
  for(let i=0;i<turnWindowSize;i++){
    const idx = visibleTurnIndex + i;
    if(idx >= steps.length) break;
    const s = steps[idx];
    const li = document.createElement('div');
    li.className='turnStep';
    li.innerHTML = `<div class="instr">${s.maneuver.instruction || s.name}</div><div class="meta">${Math.round(s.distance)} m</div>`;
    frag.appendChild(li);
  }
  container.appendChild(frag);
}

/* Advance / go back steps (Next/Previous) — when previous steps finished call this to show next window */
function advanceTurns(delta){
  const steps = map._navSteps || [];
  if(!steps.length) return;
  visibleTurnIndex += delta;
  if(visibleTurnIndex < 0) visibleTurnIndex = 0;
  if(visibleTurnIndex > steps.length - turnWindowSize) visibleTurnIndex = Math.max(0, steps.length - turnWindowSize);
  renderVisibleTurns();
  speakVisibleTurns();
}

/* Speak the visible turns with TTS */
function speakVisibleTurns(){
  if(!ttsEnabled || !('speechSynthesis' in window)) return;
  const steps = map._navSteps || [];
  let text = '';
  for(let i=0;i<turnWindowSize;i++){
    const s = steps[visibleTurnIndex + i];
    if(!s) break;
    text += (s.maneuver.instruction || s.name) + '. ';
  }
  if(text) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = (document.getElementById('settingLanguage')?.value || 'sv') === 'sv' ? 'sv-SE' : 'en-US';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }
}

/* ---------- CLEAR ROUTE & DEST ---------- */
function clearRoute(){
  if(routeGeoLayer){ map.removeLayer(routeGeoLayer); routeGeoLayer=null; }
  if(destinationMarker){ map.removeLayer(destinationMarker); destinationMarker=null; }
  map._navSteps = [];
  visibleTurnIndex = 0;
  document.getElementById('directionsList').innerHTML = 'Ingen rutt aktiv.';
  document.getElementById('turnControls').classList.add('hidden');
  currentRoute = null;
}

/* ---------- FAVORITES ---------- */
function renderFavorites(){
  const el = document.getElementById('favList'); el.innerHTML='';
  favorites.forEach((f, idx)=>{
    const li = document.createElement('li');
    li.textContent = f.name;
    li.style.cursor='pointer';
    li.onclick = ()=>{ addDestination(f.lat,f.lon,f.name); map.setView([f.lat,f.lon],15); };
    el.appendChild(li);
  });
}
function saveQuickFavorite(name){
  if(!userMarker) { toast('Ingen pos att spara'); return; }
  const pos = userMarker.getLatLng();
  favorites = favorites.filter(x=>x.name!==name);
  favorites.unshift({name,lat:pos.lat,lon:pos.lng});
  if(favorites.length>10) favorites.pop();
  saveState(); renderFavorites();
  toast('Favorit sparad');
}

/* ---------- SHARE ---------- */
function shareView(){
  const c = map.getCenter(); const z = map.getZoom();
  const url = `${location.origin}${location.pathname}?lat=${c.lat}&lng=${c.lng}&z=${z}`;
  navigator.clipboard.writeText(url).then(()=>toast('Länk kopierad'));
}

/* ---------- MEASURE TOOL (simple line distance) ---------- */
let measureMode=false; let measurePoints=[]; let measureLayer=null;
function initMeasureTool(){}
function toggleMeasureMode(){
  measureMode = !measureMode;
  if(measureMode){
    toast('Mätläge: klicka punkter på kartan (dubbelklick avslutar).');
    map.on('click', onMeasureClick);
    map.on('dblclick', finishMeasure);
  } else {
    map.off('click', onMeasureClick);
    map.off('dblclick', finishMeasure);
    if(measureLayer) map.removeLayer(measureLayer);
    measurePoints=[]; measureLayer=null;
  }
}
function onMeasureClick(e){
  measurePoints.push([e.latlng.lat,e.latlng.lng]);
  if(measureLayer) map.removeLayer(measureLayer);
  measureLayer = L.polyline(measurePoints).addTo(map);
}
function finishMeasure(){
  if(measurePoints.length<2) return;
  // compute distance
  let total=0;
  for(let i=1;i<measurePoints.length;i++){
    total += map.distance(measurePoints[i-1],measurePoints[i]);
  }
  toast(`Avstånd: ${Math.round(total)} m`);
  // keep the layer for a short while
  setTimeout(()=>{ if(measureLayer) map.removeLayer(measureLayer); measurePoints=[]; measureLayer=null; measureMode=false; }, 6000);
}

/* ---------- TRAFIKVERKET (load incidents) ---------- */
function loadTrafficIncidents(){
  if(!CONFIG.trafikverket || !CONFIG.trafikverket.apiKey) { console.warn('Trafikverket nyckel saknas'); return; }

  // Example XML request for Situation — adjust filters as needed
  const req = `<REQUEST><LOGIN authenticationkey='${CONFIG.trafikverket.apiKey}' /><QUERY objecttype='Situation'><FILTER></FILTER></QUERY></REQUEST>`;
  fetch(CONFIG.trafikverket.apiUrl, { method:'POST', headers:{'Content-Type':'application/xml'}, body:req })
    .then(r=>r.json()).then(j=>{
      try{
        const situations = j.RESPONSE.RESULT[0].Situation || [];
        situations.forEach(sit=>{
          // parse geometry if available (very variable in TV schema)
          const msg = (sit.SituationRecord || sit.Message || sit.Deviation || sit.Header || {}).Message || 'Trafikhändelse';
          // try to find lat/lon in various fields — this is schematic: adapt to actual API format
          let lat=null, lon=null;
          if(sit.Location && sit.Location.Point && sit.Location.Point.LocationCoordinate){
            const lc = sit.Location.Point.LocationCoordinate;
            lat = parseFloat(lc.Latitude);
            lon = parseFloat(lc.Longitude);
          } else if(sit.Geometry && typeof sit.Geometry === 'string'){
            const m = sit.Geometry.match(/POINT \(([-\d\.]+) ([-\d\.]+)\)/);
            if(m){ lon=parseFloat(m[1]); lat=parseFloat(m[2]); }
          }
          if(lat && lon){
            L.circleMarker([lat,lon],{radius:7,color:'#e74c3c',fillColor:'#fff',weight:2}).addTo(map).bindPopup(`<b>Trafik</b><br>${msg}`);
          }
        });
      }catch(e){ console.warn('Trafik parse failed',e); }
    }).catch(err=>console.error('Trafikverket fetch error',err));
}

/* ---------- WEATHER (placeholder) ---------- */
function loadWeatherAlerts(){
  if(!CONFIG.weather || !CONFIG.weather.apiUrl) return;
  // Implement per chosen weather service (SMHI/OpenWeather)
}

/* ---------- CHARGING STATIONS (OpenChargeMap) ---------- */
function loadChargingStations(centerLat,centerLon){
  const lat = centerLat || (userMarker && userMarker.getLatLng().lat) || 59.3293;
  const lon = centerLon || (userMarker && userMarker.getLatLng().lng) || 18.0686;
  if(!CONFIG.charging || !CONFIG.charging.apiUrl) return;
  const url = `${CONFIG.charging.apiUrl}?output=json&countrycode=SE&latitude=${lat}&longitude=${lon}&distance=10&maxresults=30`;
  fetch(url).then(r=>r.json()).then(data=>{
    data.forEach(st=>{
      if(st.AddressInfo) L.marker([st.AddressInfo.Latitude,st.AddressInfo.Longitude],{title:'Laddstation'}).addTo(map).bindPopup(`<b>Laddstation</b><br>${st.AddressInfo.Title||''}`);
    });
  }).catch(e=>console.warn('Charging load err',e));
}

/* ---------- PARKING (placeholder) ---------- */
function loadParking(){
  if(!CONFIG.parking || !CONFIG.parking.apiUrl) return;
  // fetch list of parkings and add markers
}

/* ---------- SETTINGS MODAL ---------- */
function toggleSettings(show){
  const m = document.getElementById('settingsModal');
  if(show) m.classList.remove('hidden'); else m.classList.add('hidden');
  // fill form with current state
  if(show){
    document.getElementById('settingLanguage').value = localStorage.getItem('appLang')||'sv';
    document.getElementById('settingTheme').value = currentTheme;
    document.getElementById('settingUiPos').value = localStorage.getItem('uiPos') || 'top';
    document.getElementById('toggleTraffic').checked = localStorage.getItem('toggleTraffic')!=='false';
    document.getElementById('toggleWeather').checked = localStorage.getItem('toggleWeather')!=='false';
    document.getElementById('togglePOI').checked = localStorage.getItem('togglePOI')!=='false';
    document.getElementById('toggleAutoReroute').checked = localStorage.getItem('toggleAutoReroute')==='true';
    document.getElementById('toggleRecenter').checked = localStorage.getItem('toggleRecenter')==='true';
  }
}
function saveSettingsFromModal(){
  const lang = document.getElementById('settingLanguage').value;
  const theme = document.getElementById('settingTheme').value;
  const uiPos = document.getElementById('settingUiPos').value;
  localStorage.setItem('appLang', lang);
  localStorage.setItem('uiPos', uiPos);
  localStorage.setItem('toggleTraffic', document.getElementById('toggleTraffic').checked);
  localStorage.setItem('toggleWeather', document.getElementById('toggleWeather').checked);
  localStorage.setItem('togglePOI', document.getElementById('togglePOI').checked);
  localStorage.setItem('toggleAutoReroute', document.getElementById('toggleAutoReroute').checked);
  localStorage.setItem('toggleRecenter', document.getElementById('toggleRecenter').checked);
  // apply theme immediately
  setTheme(theme);
  toggleSettings(false);
  toast('Inställningar sparade');
}

/* ---------- THEME ---------- */
function setTheme(t){
  if(t==='dark'){ if(map.hasLayer(lightLayer)) map.removeLayer(lightLayer); if(!map.hasLayer(darkLayer)) map.addLayer(darkLayer); currentTheme='dark'; }
  else { if(map.hasLayer(darkLayer)) map.removeLayer(darkLayer); if(!map.hasLayer(lightLayer)) map.addLayer(lightLayer); currentTheme='light'; }
}

/* ---------- TTS wrapper ---------- */
function ttsSpeak(text){
  if(!ttsEnabled || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = (localStorage.getItem('appLang')==='sv') ? 'sv-SE' : 'en-US';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

/* ---------- AUTO REROUTE (placeholder) ---------- */
function tryAutoRerouteIfNeeded(){
  if(localStorage.getItem('toggleAutoReroute')!=='true') return;
  // TODO: Check traffic incidents along current route and call OSRM to replan alternative if blocked.
  // This typically requires server assistance to evaluate delays and new optimal route.
}

/* ---------- INIT ---------- */
document.addEventListener('DOMContentLoaded', ()=>{
  initApp();
});
