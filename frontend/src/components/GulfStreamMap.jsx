import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const GulfStreamMap = () => {
  const [startPos, setStartPos] = useState([38.9072, -77.0369]);
  const [routeData, setRouteData] = useState(null);
  const [metadata, setMetadata] = useState({ stream_profit: "0.0 kt", eta: "--", status: "Idle" });

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
    <div style={{ display: 'flex', height: '100vh', width: '100vw', background: '#1a1a1a' }}>
      {/* TACTICAL HUD SIDEBAR */}
      <div style={{ width: '250px', background: '#000', color: '#00ff00', padding: '20px', borderRight: '2px solid #333', fontFamily: 'monospace' }}>
        <h2 style={{ color: '#fff', fontSize: '1.2rem', borderBottom: '1px solid #333' }}>NAV DATA</h2>
        <div style={{ marginTop: '30px' }}>
          <p style={{ color: '#888' }}>CURRENT PROFIT</p>
          <p style={{ fontSize: '2rem', fontWeight: 'bold' }}>{metadata.stream_profit}</p>
        </div>
        <div style={{ marginTop: '20px' }}>
          <p style={{ color: '#888' }}>ETA TO BERMUDA</p>
          <p style={{ fontSize: '1.5rem' }}>{metadata.eta}</p>
        </div>
        <div style={{ marginTop: '20px' }}>
          <p style={{ color: '#888' }}>ENGINE STATUS</p>
          <p style={{ fontSize: '0.8rem', color: '#f1c40f' }}>{metadata.status}</p>
        </div>
        <div style={{ position: 'absolute', bottom: '20px' }}>
          <p style={{ fontSize: '0.7rem', color: '#444' }}>MOMENTUM PWA v1.0</p>
        </div>
      </div>

      {/* MAP AREA */}
      <div style={{ flex: 1, position: 'relative' }}>
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
