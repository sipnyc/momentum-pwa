import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const GulfStreamMap = () => {
  const [startPos, setStartPos] = useState([38.9072, -77.0369]);
  const [routeData, setRouteData] = useState(null);
  const [metadata, setMetadata] = useState({ wind_speed: "-- kt", vmg: "-- kt", eta: "--" });

  const API_BASE = window.location.origin.replace('-5173', '-8000');

  const fetchRoute = async (lat, lon) => {
    try {
      const response = await fetch(`${API_BASE}/calculate_route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lon })
      });
      const data = await response.json();
      setRouteData(data.points);
      setMetadata(data.metadata);
    } catch (err) {
      console.error("Link to Brain failed", err);
    }
  };

  const MapEvents = () => {
    useMapEvents({
      click: (e) => {
        setStartPos([e.latlng.lat, e.latlng.lng]);
        fetchRoute(e.latlng.lat, e.latlng.lng);
      },
    });
    return null;
  };

  return (
    <div className="app-container">
      {/* TACTICAL HUD SIDEBAR */}
      <div className="dashboard-side">
        <h2 style={{ color: '#fff', fontSize: '1.2rem', borderBottom: '1px solid #333', marginTop: 0 }}>NAV DATA</h2>
        
        <div style={{ marginTop: '30px' }}>
          <p style={{ color: '#888', marginBottom: '5px', fontSize: '0.9rem', letterSpacing: '1px' }}>WIND</p>
          <p style={{ fontSize: '2.2rem', fontWeight: 'bold', color: '#00ff00', fontFamily: 'monospace', letterSpacing: '2px', textShadow: '0 0 10px #00ff00' }}>{metadata.wind_speed}</p>
        </div>
        
        <div style={{ marginTop: '25px' }}>
          <p style={{ color: '#888', marginBottom: '5px', fontSize: '0.9rem', letterSpacing: '1px' }}>VMG</p>
          <p style={{ fontSize: '2.2rem', fontWeight: 'bold', color: '#00ff00', fontFamily: 'monospace', letterSpacing: '2px', textShadow: '0 0 10px #00ff00' }}>{metadata.vmg}</p>
        </div>
        
        <div style={{ marginTop: '25px' }}>
          <p style={{ color: '#888', marginBottom: '5px', fontSize: '0.9rem', letterSpacing: '1px' }}>ETA</p>
          <p style={{ fontSize: '1.8rem', color: '#00ff00', fontFamily: 'monospace', letterSpacing: '1px', textShadow: '0 0 10px #00ff00' }}>{metadata.eta}</p>
        </div>
        
        <div style={{ position: 'fixed', bottom: '20px', left: '20px' }}>
          <p style={{ fontSize: '0.7rem', color: '#444' }}>MOMENTUM PWA v1.0</p>
        </div>
      </div>

      {/* MAP AREA */}
      <div className="map-side">
        <MapContainer center={startPos} zoom={5} style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <MapEvents />
          <Marker position={startPos}><Popup>Current Position</Popup></Marker>
          <Marker position={[32.3078, -64.7505]}><Popup>Bermuda Finish</Popup></Marker>
          {routeData && <Polyline positions={routeData} color="#00ffff" weight={4} />}
        </MapContainer>
      </div>
    </div>
  );
};

export default GulfStreamMap;
