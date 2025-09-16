/* script.js — komplett klientlogik (Leaflet + routing + TTS + API-hooks + UI) */

/* ---------- CONFIG ---------- */
const CONFIG = window.APP_CONFIG || {};

/* ---------- GLOBALS ---------- */
let map, lightLayer, darkLayer;
let userMarker = null;
let followMode = true;
let currentTheme = 'light';
let destinationMarker = null;
let routeGeoLayer = null;
let currentRoute = null;
let transportMode = localStorage.getItem('defaultMode') || 'driving';
let turnWindowSize = 2;
let visibleTurnIndex = 0;
let ttsEnabled = (localStorage.getItem('toggleTTS') !== 'false');
let recentSearches = JSON.parse(localStorage.getItem('recentSearches') || '[]');
let favorites = JSON.parse(localStorage.getItem('favorites') || '[]');

const DEBUG = CONFIG.other && CONFIG.other.enableDebug;

/* ---------- UTIL ---------- */
function log(...args){ if(DEBUG) console.log(...args); }
function toast(msg, ms=3000){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(()=> t.classList.add('hidden'), ms);
}
function saveState(){
  localStorage.setItem('recentSearches', JSON.stringify(recentSearches.slice(0,50)));
  localStorage.setItem('favorites', JSON.stringify(favorites.slice(0,50)));
  localStorage.setItem('defaultMode', transportMode);
  localStorage.setItem('toggleTTS', ttsEnabled);
}

/* ---------- INIT MAP ---------- */
function initMap(){
  const tileLight = (CONFIG.map && CONFIG.map.tiles && CONFIG.map.tiles.light) || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const tileDark  = (CONFIG.map && CONFIG.map.tiles && CONFIG.map.tiles.dark) || 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  const attr = (CONFIG.map && CONFIG.map.attribution) || '';

  map = L.map('map', { zoomControl:false }).setView([59.3293,18.0686],13);
  lightLayer = L.tileLayer(tileLight, { attribution: attr });
  darkLayer  = L.tileLayer(tileDark, { attribution: attr });

  (currentTheme==='dark' ? darkLayer.addTo(map) : lightLayer.addTo(map));
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  startGeolocation();

  renderRecents();
  renderFavorites();
  bindUI();

  // initial POI layers if toggles active
  if(document.getElementById('togglePOI')?.checked) {
    loadChargingStations();
    loadParking();
  }
  if(document.getElementById('toggleTraffic')?.checked) {
    loadTrafficIncidents();
  }
}

/* ---------- GEOLOCATION / FOLLOW ---------- */
function startGeolocation(){
  if(!navigator.geolocation){ toast('GPS stöds ej i denna webbläsare'); return; }

  // One-shot to get a position ASAP
  navigator.geolocation.getCurrentPosition(pos=>{
    updateUserPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.speed);
  }, err=>{
    console.warn('Initial geo failed', err);
  }, { enableHighAccuracy:true, timeout:5000 });

  // Watch position for continuous updates
  navigator.geolocation.watchPosition(pos=>{
    updateUserPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.speed);
  }, err=>{
    console.warn('watchPosition failed', err);
  }, { enableHighAccuracy:true, maximumAge:1000, distanceFilter:1 });
}

function updateUserPosition(lat,lng,accuracy,speed){
  if(!userMarker){
    userMarker = L.circleMarker([lat,lng], { radius:8, fillColor:'#007bff', color:'#fff', weight:2 }).addTo(map).bindPopup('Du är här');
    if(followMode) map.setView([lat,lng],15);
  } else {
    userMarker.setLatLng([lat,lng]);
    if(followMode) map.panTo([lat,lng]);
  }
  // optionally update live-sharing position logic here (requires backend)
  checkProgressAgainstRoute(lat,lng);
}

/* ---------- UI BINDINGS ---------- */
function bindUI(){
  // Search
  document.getElementById('searchBtn').addEventListener('click', ()=> {
    const q = document.getElementById('searchInput').value.trim();
    if(q) performSearch(q);
  });
  document.getElementById('searchInput').addEventListener('keydown', (e)=>{
    if(e.key === 'Enter'){ document.getElementById('searchBtn').click(); }
  });

  // transport buttons
  document.querySelectorAll('#transportButtons .mode').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('#transportButtons .mode').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      transportMode = btn.dataset.mode;
      localStorage.setItem('defaultMode', transportMode);
      toast(`Färdsätt: ${transportMode}`);
    });
    // set initial active
    if(btn.dataset.mode === transportMode) btn.classList.add('active');
  });

  // locate
  document.getElementById('btnLocate').addEventListener('click', ()=>{
    if(userMarker) map.setView(userMarker.getLatLng(), 16);
    else startGeolocation();
  });

  // measure
  document.getElementById('btnMeasure').addEventListener('click', ()=> toggleMeasureMode());

  // share
  document.getElementById('btnShare').addEventListener('click', shareView);

  // report
  document.getElementById('btnReport').addEventListener('click', ()=> openReportDialog());

  // settings modal
  document.getElementById('btnSettings').addEventListener('click', ()=> toggleSettings(true));
  document.getElementById('closeSettings').addEventListener('click', ()=> toggleSettings(false));
  document.getElementById('saveSettingsBtn').addEventListener('click', ()=> saveSettingsFromModal());

  // profile modal
  document.getElementById('btnProfile').addEventListener('click', ()=> toggleProfile(true));
  document.getElementById('closeProfile')?.addEventListener('click', ()=> toggleProfile(false));
  document.getElementById('saveProfile')?.addEventListener('click', saveProfileLocal);

  // route controls
  document.getElementById('btnNextStep').addEventListener('click', ()=> advanceTurns(1));
  document.getElementById('btnPrevStep').addEventListener('click', ()=> advanceTurns(-1));
  document.getElementById('btnCancelRoute').addEventListener('click', ()=> clearRoute());

  // recenter toggle
  const recenterCheckbox = document.getElementById('toggleRecenter');
  recenterCheckbox.addEventListener('change', (e)=> {
    followMode = e.target.checked;
    if(followMode && userMarker) map.setView(userMarker.getLatLng(), 15);
  });

  // default mode from settings
  const saved = localStorage.getItem('defaultMode') || transportMode;
  const selectDefault = document.getElementById('defaultMode');
  if(selectDefault) selectDefault.value = saved;
  // tts toggle
  const ttsToggle = document.getElementById('toggleTTS');
  if(ttsToggle) ttsToggle.checked = ttsEnabled;
}

/* ---------- SEARCH (Nominatim) ---------- */
function performSearch(q){
  const nom = CONFIG.nominatim || 'https://nominatim.openstreetmap.org/search';
  const url = `${nom}?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=5`;
  fetch(url).then(r=>r.json()).then(results=>{
    if(!results || !results.length){ toast('Inga träffar'); return; }
    showSearchResults(results);
    // automatically pick first for convenience
    const first = results[0];
    addDestinationMarker(parseFloat(first.lat), parseFloat(first.lon), first.display_name, first);
    // recent
    recentSearches = [q].concat(recentSearches.filter(x=>x!==q)).slice(0,20);
    renderRecents(); saveState();
  }).catch(err=>{
    console.error('Search error',err); toast('Sökfel');
  });
}

function showSearchResults(results){
  const dropdown = document.getElementById('searchResults');
  dropdown.innerHTML = '';
  results.forEach(r=>{
    const div = document.createElement('div');
    div.className = 'result';
    div.textContent = r.display_name;
    div.addEventListener('click', ()=> {
      document.getElementById('searchInput').value = r.display_name;
      addDestinationMarker(parseFloat(r.lat), parseFloat(r.lon), r.display_name, r);
      dropdown.classList.add('hidden');
    });
    dropdown.appendChild(div);
  });
  dropdown.classList.remove('hidden');
}

/* ---------- DESTINATION POPUP ---------- */
function addDestinationMarker(lat,lon,name,meta){
  if(destinationMarker) { map.removeLayer(destinationMarker); destinationMarker=null; }
  destinationMarker = L.marker([lat,lon], { title:name }).addTo(map);

  const popupHtml = document.createElement('div');
  popupHtml.style.maxWidth = '260px';
  popupHtml.innerHTML = `<b>${name}</b><div style="margin-top:8px;display:flex;gap:6px;">
    <button id="startRouteBtn">🚀 Starta rutt</button>
    <button id="saveFavBtn">⭐ Spara</button>
    <button id="sharePlaceBtn">🔗 Dela</button>
  </div>`;

  destinationMarker.bindPopup(popupHtml).openPopup();
  map.panTo([lat,lon]);

  // add event listeners after DOM insertion
  setTimeout(()=>{
    const startBtn = document.getElementById('startRouteBtn');
    if(startBtn) startBtn.addEventListener('click', ()=> {
      startRouteTo(lat,lon);
    });
    const favBtn = document.getElementById('saveFavBtn');
    if(favBtn) favBtn.addEventListener('click', ()=> {
      const label = prompt('Namn för favorit:', name) || name;
      favorites.unshift({ name: label, lat, lon });
      saveState(); renderFavorites(); toast('Favorit sparad');
    });
    const shareBtn = document.getElementById('sharePlaceBtn');
    if(shareBtn) shareBtn.addEventListener('click', ()=> {
      const url = `${location.origin}${location.pathname}?lat=${lat}&lng=${lon}&z=${map.getZoom()}`;
      navigator.clipboard.writeText(url).then(()=> toast('Länk kopierad'));
    });
  },50);

  // remove route if popup closed
  destinationMarker.on('popupclose', ()=> {
    // do not automatically clear route if user already navigates; but for simplicity we clear destination marker only
    // clearRoute(); 
  });
}

/* ---------- START ROUTE (OSRM) ---------- */
function startRouteTo(destLat, destLon){
  // ensure start position
  if(!userMarker){
    if(confirm('Din position saknas. Tillåt position?')){
      startGeolocation();
      toast('Vänta på position och försök igen');
    } else {
      toast('Behöver position för rutt');
    }
    return;
  }

  const start = userMarker.getLatLng();
  // determine profile
  let profile = localStorage.getItem('defaultMode') || transportMode || 'driving';
  // map possibly to supported OSRM profiles
  profile = (profile === 'driving' || profile === 'cycling' || profile === 'walking') ? profile : 'driving';
  if(profile === 'transit'){ // placeholder
    toast('Kollektivtrafik-rutter kräver SL/Västtrafik-integration (TODO)');
    return;
  }

  const base = (CONFIG.osrm || 'https://router.project-osrm.org') + '/route/v1';
  const url = `${base}/${profile}/${start.lng},${start.lat};${destLon},${destLat}?overview=full&geometries=geojson&steps=true&annotations=maxspeed,duration,distance`;

  log('Routing URL', url);
  fetch(url).then(r=>r.json()).then(j=>{
    if(!j || !j.routes || !j.routes.length){
      toast('Ingen rutt hittades för valt färdsätt eller koordinaterna är ogiltiga.');
      return;
    }
    currentRoute = j.routes[0];
    if(routeGeoLayer) map.removeLayer(routeGeoLayer);
    routeGeoLayer = L.geoJSON(currentRoute.geometry, { style:{ color:'#2b7ae4', weight:6, opacity:0.95 } }).addTo(map);
    map.fitBounds(routeGeoLayer.getBounds(), { padding:[40,40] });

    // Flatten steps and show first window
    const steps = [];
    currentRoute.legs.forEach(leg => leg.steps.forEach(s=> steps.push(s)));
    map._navSteps = steps;
    visibleTurnIndex = 0;
    renderVisibleTurns();
    document.getElementById('turnControls').classList.remove('hidden');

    // TTS speak first window
    speakVisibleTurns();
    // start monitoring progress if recenter/follow enabled
    if(document.getElementById('toggleAutoReroute')?.checked){ tryAutoRerouteIfNeeded(); }
  }).catch(err=>{
    console.error('OSRM error', err);
    toast('Fel vid ruttberäkning. Kontrollera nätverk/CORS.');
  });
}

/* ---------- DIRECTIONS WINDOW (2 steps) ---------- */
function renderVisibleTurns(){
  const container = document.getElementById('directionsList');
  container.innerHTML = '';
  const steps = map._navSteps || [];
  if(!steps.length){ container.innerHTML = 'Ingen rutt aktiv.'; return; }

  // clamp
  if(visibleTurnIndex < 0) visibleTurnIndex = 0;
  if(visibleTurnIndex > Math.max(0, steps.length - turnWindowSize)) visibleTurnIndex = Math.max(0, steps.length - turnWindowSize);

  for(let i=0;i<turnWindowSize;i++){
    const idx = visibleTurnIndex + i;
    if(idx >= steps.length) break;
    const s = steps[idx];
    const el = document.createElement('div');
    el.className = 'turnStep';
    const instr = s.maneuver && (s.maneuver.instruction || s.maneuver.type + ' ' + (s.name || '')) || s.name || 'Fortsätt';
    el.innerHTML = `<div>${instr}</div><div class="meta">${Math.round(s.distance)} m</div>`;
    container.appendChild(el);
  }
}
function advanceTurns(delta){
  const steps = map._navSteps || [];
  if(!steps.length) return;
  visibleTurnIndex += delta;
  if(visibleTurnIndex < 0) visibleTurnIndex = 0;
  if(visibleTurnIndex > steps.length - turnWindowSize) visibleTurnIndex = Math.max(0, steps.length - turnWindowSize);
  renderVisibleTurns();
  speakVisibleTurns();
}

/* ---------- TTS ---------- */
function speakVisibleTurns(){
  if(!ttsEnabled || !('speechSynthesis' in window)) return;
  const steps = map._navSteps || [];
  let text = '';
  for(let i=0;i<turnWindowSize;i++){
    const s = steps[visibleTurnIndex + i];
    if(!s) break;
    text += (s.maneuver && (s.maneuver.instruction || s.name) || s.name || '') + '. ';
  }
  if(text){
    const u = new SpeechSynthesisUtterance(text);
    const lang = document.getElementById('settingLanguage')?.value || 'sv';
    u.lang = (lang === 'sv') ? 'sv-SE' : (lang === 'de' ? 'de-DE' : (lang === 'es' ? 'es-ES' : 'en-US'));
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }
}

/* ---------- AUTO-PROGRESS / Geofence detection (advance when close to maneuver) ---------- */
function checkProgressAgainstRoute(lat,lng){
  const steps = map._navSteps || [];
  if(!steps.length) return;
  // check distance to next maneuver coordinate (if available)
  const nextIdx = visibleTurnIndex;
  const m = steps[nextIdx] && steps[nextIdx].maneuver && steps[nextIdx].maneuver.location;
  if(m && m.length === 2){
    const [mlon, mlat] = m; // OSRM sometimes uses [lon,lat]
    const dist = map.distance([lat,lng],[mlat,mlon]);
    if(dist < 20){ // 20 meters threshold
      // we consider this step completed -> advance
      if(visibleTurnIndex + turnWindowSize < steps.length){
        visibleTurnIndex++;
        renderVisibleTurns();
        if(ttsEnabled) speakVisibleTurns();
      } else {
        // route completed
        toast('Du har nått målet!');
        setTimeout(()=> clearRoute(), 2500);
      }
    }
  }
}

/* ---------- CLEAR ROUTE ---------- */
function clearRoute(){
  if(routeGeoLayer) map.removeLayer(routeGeoLayer);
  routeGeoLayer = null;
  currentRoute = null;
  map._navSteps = [];
  visibleTurnIndex = 0;
  document.getElementById('directionsList').innerHTML = 'Ingen rutt aktiv.';
  document.getElementById('turnControls').classList.add('hidden');
  if(destinationMarker){ map.removeLayer(destinationMarker); destinationMarker=null; }
}

/* ---------- FAVORITES / RECENTS ---------- */
function renderFavorites(){
  const el = document.getElementById('favList'); el.innerHTML = '';
  favorites.forEach((f,idx)=>{
    const li = document.createElement('li'); li.style.cursor='pointer';
    li.textContent = f.name;
    li.onclick = ()=> { addDestinationMarker(f.lat,f.lon,f.name); map.setView([f.lat,f.lon],15); };
    el.appendChild(li);
  });
}
function renderRecents(){
  const el = document.getElementById('recentList'); el.innerHTML = '';
  recentSearches.forEach(s=>{
    const li = document.createElement('li'); li.style.cursor='pointer';
    li.textContent = s;
    li.onclick = ()=> { document.getElementById('searchInput').value = s; performSearch(s); };
    el.appendChild(li);
  });
}

/* ---------- SHARE VIEW ---------- */
function shareView(){
  const c = map.getCenter();
  const z = map.getZoom();
  const url = `${location.origin}${location.pathname}?lat=${c.lat}&lng=${c.lng}&z=${z}`;
  navigator.clipboard.writeText(url).then(()=> toast('Dela-länk kopierad'));
}

/* ---------- MEASURE TOOL ---------- */
let measureMode=false, measurePoints=[], measureLayer=null;
function toggleMeasureMode(){
  measureMode = !measureMode;
  if(measureMode){
    toast('Mätläge: klicka punkter på kartan, dubbelklick för avsluta');
    map.on('click', onMeasureClick);
    map.on('dblclick', finishMeasure);
  } else {
    map.off('click', onMeasureClick);
    map.off('dblclick', finishMeasure);
    if(measureLayer) map.removeLayer(measureLayer);
    measureLayer = null; measurePoints = [];
  }
}
function onMeasureClick(e){
  measurePoints.push([e.latlng.lat, e.latlng.lng]);
  if(measureLayer) map.removeLayer(measureLayer);
  measureLayer = L.polyline(measurePoints, { color:'#111' }).addTo(map);
}
function finishMeasure(){
  if(measurePoints.length < 2) return;
  let total = 0;
  for(let i=1;i<measurePoints.length;i++){
    total += map.distance(measurePoints[i-1], measurePoints[i]);
  }
  toast(`Avstånd: ${Math.round(total)} m`);
  setTimeout(()=>{ if(measureLayer) map.removeLayer(measureLayer); measureLayer=null; measurePoints=[]; }, 6000);
}

/* ---------- TRAFIKVERKET (EVENTS) ---------- */
function loadTrafficIncidents(){
  if(!CONFIG.trafikverket || !CONFIG.trafikverket.apiKey){
    log('Trafikverket API-nyckel saknas. Hoppar trafik.');
    return;
  }

  // Minimal example request (XML) - adapt filters to your needs
  const xmlReq = `<REQUEST>
    <LOGIN authenticationkey='${CONFIG.trafikverket.apiKey}'/>
    <QUERY objecttype='Situation'>
      <FILTER/>
    </QUERY>
  </REQUEST>`;

  fetch(CONFIG.trafikverket.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: xmlReq
  }).then(r=>r.json()).then(j=>{
    try{
      const res = j.RESPONSE?.RESULT?.[0]?.Situation || [];
      res.forEach(sit=>{
        // heuristic parsing (API schema varies)
        let lat = null, lon = null, msg = sit.Message || sit.Header || 'Trafikhändelse';
        if(sit.Location && sit.Location[0] && sit.Location[0].Point && sit.Location[0].Point[0] && sit.Location[0].Point[0].LocationCoordinate){
          const lc = sit.Location[0].Point[0].LocationCoordinate[0];
          lat = parseFloat(lc.Latitude); lon = parseFloat(lc.Longitude);
        } else if(sit.Geometry && typeof sit.Geometry === 'string'){
          const m = sit.Geometry.match(/POINT \(([-\d\.]+) ([-\d\.]+)\)/);
          if(m){ lon=parseFloat(m[1]); lat=parseFloat(m[2]); }
        }
        if(lat && lon){
          L.circleMarker([lat,lon], { radius:7, color:'#e74c3c', fillColor:'#fff', weight:2 }).addTo(map).bindPopup(`<b>Trafik</b><br>${msg}`);
        }
      });
    }catch(e){ console.warn('Trafik parse', e); }
  }).catch(err=> console.error('Trafik fetch error', err));
}

/* ---------- OPENCHARGEMAP (Laddstationer) ---------- */
function loadChargingStations(centerLat,centerLon){
  const lat = centerLat || (userMarker && userMarker.getLatLng().lat) || 59.3293;
  const lon = centerLon || (userMarker && userMarker.getLatLng().lng) || 18.0686;
  if(!CONFIG.charging || !CONFIG.charging.apiUrl) { log('No charging API'); return; }
  const url = `${CONFIG.charging.apiUrl}?output=json&countrycode=SE&latitude=${lat}&longitude=${lon}&distance=10&maxresults=30`;
  fetch(url).then(r=>r.json()).then(data=>{
    data.forEach(s => {
      if(s.AddressInfo && s.AddressInfo.Latitude && s.AddressInfo.Longitude){
        L.marker([s.AddressInfo.Latitude, s.AddressInfo.Longitude], { title:'Laddstation' }).addTo(map).bindPopup(`<b>Laddstation</b><br>${s.AddressInfo.Title || ''}`);
      }
    });
  }).catch(e=>console.warn('Charging load err', e));
}

/* ---------- PARKING (placeholder if api provided) ---------- */
function loadParking(){
  if(!CONFIG.parking || !CONFIG.parking.apiUrl) { log('No parking API'); return; }
  fetch(CONFIG.parking.apiUrl).then(r=>r.json()).then(data=>{
    data.forEach(p => {
      if(p.lat && p.lon) L.marker([p.lat,p.lon], { title:'Parkering' }).addTo(map).bindPopup(`<b>Parkering</b><br>${p.name || ''}`);
    });
  }).catch(e=>console.warn('Parking load error', e));
}

/* ---------- REPORTS (user -> store locally or send to api) ---------- */
function openReportDialog(){
  const type = prompt('Typ av rapport (poliskontroll, hinder, olycka, vägarbete):');
  if(!type) return;
  if(!userMarker){ toast('Behöver position för rapport.'); return; }
  const pos = userMarker.getLatLng();
  const report = { type, lat: pos.lat, lon: pos.lng, ts: Date.now() };
  // if there's an API endpoint, post it; otherwise store locally
  if(CONFIG.reports && CONFIG.reports.apiUrl){
    fetch(CONFIG.reports.apiUrl, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(report) })
      .then(()=> toast('Rapport skickad')).catch(()=> { localStoreReport(report); toast('Rapport sparad lokalt'); });
  } else {
    localStoreReport(report); toast('Rapport sparad lokalt (ingen server)');
  }
}
function localStoreReport(r){ const arr = JSON.parse(localStorage.getItem('userReports')||'[]'); arr.unshift(r); localStorage.setItem('userReports', JSON.stringify(arr)); }

/* ---------- SETTINGS MODAL ---------- */
function toggleSettings(show){
  const m = document.getElementById('settingsModal');
  if(show) m.classList.remove('hidden'); else m.classList.add('hidden');

  if(show){
    // populate form with existing values
    document.getElementById('settingLanguage').value = localStorage.getItem('appLang') || 'sv';
    document.getElementById('settingTheme').value = currentTheme;
    document.getElementById('settingUiPos').value = localStorage.getItem('uiPos') || 'top';
    document.getElementById('defaultMode').value = localStorage.getItem('defaultMode') || transportMode || 'driving';
    document.getElementById('toggleTraffic').checked = localStorage.getItem('toggleTraffic')!=='false';
    document.getElementById('togglePOI').checked = localStorage.getItem('togglePOI')!=='false';
    document.getElementById('toggleAutoReroute').checked = localStorage.getItem('toggleAutoReroute')==='true';
    document.getElementById('toggleTTS').checked = ttsEnabled;
  }
}
function saveSettingsFromModal(){
  const lang = document.getElementById('settingLanguage').value;
  const theme = document.getElementById('settingTheme').value;
  const uiPos = document.getElementById('settingUiPos').value;
  const defMode = document.getElementById('defaultMode').value;
  localStorage.setItem('appLang', lang);
  localStorage.setItem('uiPos', uiPos);
  localStorage.setItem('defaultMode', defMode);
  localStorage.setItem('toggleTraffic', document.getElementById('toggleTraffic').checked);
  localStorage.setItem('togglePOI', document.getElementById('togglePOI').checked);
  localStorage.setItem('toggleAutoReroute', document.getElementById('toggleAutoReroute').checked);
  ttsEnabled = document.getElementById('toggleTTS').checked;
  // apply theme immediately
  setTheme(theme);
  toggleSettings(false);
  toast('Inställningar sparade');
  saveState();
}

/* ---------- THEME ---------- */
function setTheme(t){
  if(t === currentTheme) return;
  if(t === 'dark'){ if(map.hasLayer(lightLayer)) map.removeLayer(lightLayer); if(!map.hasLayer(darkLayer)) darkLayer.addTo(map); currentTheme='dark'; }
  else { if(map.hasLayer(darkLayer)) map.removeLayer(darkLayer); if(!map.hasLayer(lightLayer)) lightLayer.addTo(map); currentTheme='light'; }
}

/* ---------- AUTO REROUTE (placeholder) ---------- */
function tryAutoRerouteIfNeeded(){
  if(localStorage.getItem('toggleAutoReroute') !== 'true') return;
  // Real implementation: need server or traffic-weighted routing to decide.
  // Placeholder: simply re-run startRouteTo with same destination to refresh route.
  if(currentRoute && destinationMarker && userMarker){
    const dest = destinationMarker.getLatLng();
    startRouteTo(dest.lat, dest.lng);
    toast('Försöker omlägga rutt (placeholder)');
  }
}

/* ---------- PROFILE ---------- */
function toggleProfile(show){
  const m = document.getElementById('profileModal');
  if(!m) return;
  if(show) m.classList.remove('hidden'); else m.classList.add('hidden');
  if(show){
    const profile = JSON.parse(localStorage.getItem('profile') || '{}');
    document.getElementById('profileName').value = profile.name || '';
    document.getElementById('profileEmail').value = profile.email || '';
  }
}
function saveProfileLocal(){
  const profile = { name: document.getElementById('profileName').value, email: document.getElementById('profileEmail').value };
  localStorage.setItem('profile', JSON.stringify(profile));
  toggleProfile(false);
  toast('Profil sparad lokalt');
}

/* ---------- INIT & START ---------- */
document.addEventListener('DOMContentLoaded', ()=>{
  // attach basic listeners used by UI that exists before initMap
  document.getElementById('closeSettings').addEventListener('click', ()=> toggleSettings(false));
  document.getElementById('saveSettingsBtn').addEventListener('click', ()=> saveSettingsFromModal());
  document.getElementById('closeProfile')?.addEventListener('click', ()=> toggleProfile(false));
  document.getElementById('saveProfile')?.addEventListener('click', saveProfileLocal);

  initMap();
});

/* ---------- Final notes ----------
 - Many advanced features (Spotify connect, live sharing, push notifications, AR overlay, robust automatic reroute) require backend or platform APIs. 
 - Where server/API keys are required, config.cfg contains placeholders. 
 - If you want, jag kan: 
    1) lägga upp en minimal Node/Express-backend-exempel som handhar SL/Spotify OAuth och proxies för Trafikverket, 
    2) eller steg för steg-instruktioner för att starta en egen OSRM-server.
 - Säg vilken av de avancerade features du vill prioritera så bygger jag vidare.
*/
