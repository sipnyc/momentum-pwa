import React, { useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

function App() {
  const [startPos, setStartPos] = useState([38.9072, -77.0369]);
  const [route, setRoute] = useState(null);

  // Magic Bridge: Automatically finds your Python backend
  const API_BASE = window.location.origin.replace('-5173', '-8000');

  const fetchRoute = async (lat, lon) => {
    try {
      const response = await fetch(`${API_BASE}/isochrone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lon })
      });
      const data = await response.json();
      setRoute(data.points); // This draws the cyan line
    } catch (err) {
      console.error("Connection to Brain failed. Check Port 8000!", err);
    }
  };

  function MapEvents() {
    useMapEvents({
      contextmenu: (e) => { // 'contextmenu' is a Long-Press on iPad
        const { lat, lng } = e.latlng;
        setStartPos([lat, lng]);
        fetchRoute(lat, lng);
      },
    });
    return null;
  }

  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      <MapContainer center={startPos} zoom={5} style={{ height: '100%', width: '100%' }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <MapEvents />
        <Marker position={startPos}><Popup>Start Point</Popup></Marker>
        <Marker position={[32.3078, -64.7505]}><Popup>Bermuda Finish</Popup></Marker>
        {route && <Polyline positions={route} color="cyan" weight={5} />}
      </MapContainer>
    </div>
  );
}

export default App;
