// Läs config
let CONFIG = {};
fetch('config.cfg')
.then(r => r.text())
.then(txt => {
txt.split('\n').forEach(line => {
const [key, val] = line.split('=');
if(key && val) CONFIG[key.trim()] = val.trim();
});
});


let map = L.map('map').setView([59.3293, 18.0686], 13);
let lightTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
let darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png');
lightTiles.addTo(map);


let positionMarker, accuracyCircle;
let followMode = true;
let transportMode = 'driving';
let routeLayer;


// GPS
if(navigator.geolocation){
navigator.geolocation.watchPosition(pos => {
let lat = pos.coords.latitude, lng = pos.coords.longitude;
let acc = pos.coords.accuracy;
if(!positionMarker){
positionMarker = L.marker([lat,lng]).addTo(map).bindPopup('Du är här');
accuracyCircle = L.circle([lat,lng], { radius: acc }).addTo(map);
} else {
positionMarker.setLatLng([lat,lng]);
};
