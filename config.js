window.APP_CONFIG = {
  map: {
    tiles: {
      light: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    },
    attribution: "&copy; OpenStreetMap contributors"
  },
  osrm: "https://router.project-osrm.org", // För bil, cykel, gång
  nominatim: "https://nominatim.openstreetmap.org/search", // Geokodning (platser, adresser)
  trafikverket: {
    apiUrl: "https://api.trafikinfo.trafikverket.se/v2/data.json",
    apiKey: "1ea923daae314b80addd205c26007e35" // <-- byt ut till din riktiga nyckel
  },
  charging: {
    apiUrl: "https://api.openchargemap.io/v3/poi/"
  },
  parking: {
    apiUrl: "https://api.parkering.se/v1/parkings"
  },
  weather: {
    apiUrl: "https://opendata.smhi.se/api/category/warnings/version/2"
  },
    resrobot: {
    apiKey: "e5e2089c-3a67-4d2f-a957-b86f06b82436",  // Byt ut mot din Trafiklab-nyckel
    baseUrl: "https://api.resrobot.se/v2.1/trip",
      // Färgmedel: Buses, Metro, Tram, Ferries, Local trains, High speed trains, Regional trains
      products: 502
    },
    products: {
      AIR: 1,
      HIGH_SPEED_TRAIN: 2,
      REGIONAL_TRAIN: 4,
      LOCAL_TRAIN: 16,
      METRO: 32,
      TRAM: 64,
      BUS: 128,
      FERRY: 256,
      TAXI: 512
    }
};
