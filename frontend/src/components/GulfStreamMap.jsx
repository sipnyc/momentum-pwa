import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const GulfStreamMap = () => {
  const [startPos, setStartPos] = useState([38.9072, -77.0369]);
  const [routeData, setRouteData] = useState(null);
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(false);

  const API_BASE = window.location.origin.replace('-5173', '-8000');

  const fetchRoute = async (lat, lon) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/isochrone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lon })
      });
      const data = await response.json();
      setRouteData(data.points);
      setMeta(data.metadata || {});
    } catch (err) {
      console.error("Link to Brain failed", err);
    } finally {
      setLoading(false);
    }
  };

  const MapEvents = () => {
    useMapEvents({
      click: (e) => {
        setStartPos([e.latlng.lat, e.latlng.lng]);
        fetchRoute(e.latlng.lat, e.latlng.lng);
      },
      contextmenu: (e) => {
        setStartPos([e.latlng.lat, e.latlng.lng]);
        fetchRoute(e.latlng.lat, e.latlng.lng);
      }
    });
    return null;
  };

  return (
    <div className="app-container">
      {/* TACTICAL HUD SIDEBAR */}
      <div className="dashboard-side">
        <h2 style={{ color: '#00ff00', fontSize: '1.4rem', marginTop: 0, marginBottom: '20px', fontFamily: 'monospace', letterSpacing: '2px' }}>MOMENTUM A2B</h2>

        <div style={{ marginTop: '0', padding: '18px', background: '#051205', borderRadius: '14px', boxShadow: '0 0 30px rgba(0, 255, 0, 0.18)' }}>
          <p style={{ color: '#7f7f7f', margin: 0, fontSize: '0.85rem', letterSpacing: '1px' }}>SOG (VMG)</p>
          <p style={{ fontSize: '3rem', fontWeight: 'bold', color: '#00ff00', fontFamily: 'monospace', letterSpacing: '2px', textShadow: '0 0 14px rgba(0, 255, 0, 0.75)', margin: '10px 0 0' }}>{meta.vmg || '--'}<span style={{ fontSize: '1.2rem', marginLeft: '8px' }}>kts</span></p>
        </div>

        <div style={{ marginTop: '20px', padding: '18px', background: '#051205', borderRadius: '14px', boxShadow: '0 0 30px rgba(0, 255, 0, 0.18)' }}>
          <p style={{ color: '#7f7f7f', margin: 0, fontSize: '0.85rem', letterSpacing: '1px' }}>Wind Speed</p>
          <p style={{ fontSize: '2.4rem', fontWeight: 'bold', color: '#00ff00', fontFamily: 'monospace', letterSpacing: '2px', textShadow: '0 0 14px rgba(0, 255, 0, 0.75)', margin: '10px 0 0' }}>{meta.wind_speed || '--'}</p>
        </div>

        <div style={{ marginTop: '20px', padding: '18px', background: '#051205', borderRadius: '14px', boxShadow: '0 0 30px rgba(0, 255, 0, 0.18)' }}>
          <p style={{ color: '#7f7f7f', margin: 0, fontSize: '0.85rem', letterSpacing: '1px' }}>Current</p>
          <p style={{ fontSize: '2.4rem', fontWeight: 'bold', color: '#00ff00', fontFamily: 'monospace', letterSpacing: '2px', textShadow: '0 0 14px rgba(0, 255, 0, 0.75)', margin: '10px 0 0' }}>{meta.current_velocity || '--'}</p>
        </div>

        <div style={{ marginTop: '20px', padding: '18px', background: '#051205', borderRadius: '14px', boxShadow: '0 0 30px rgba(0, 255, 0, 0.18)' }}>
          <p style={{ color: '#7f7f7f', margin: 0, fontSize: '0.85rem', letterSpacing: '1px' }}>Status</p>
          <p style={{ fontSize: '1.6rem', fontWeight: 'bold', color: '#00ff00', fontFamily: 'monospace', letterSpacing: '1px', textShadow: '0 0 10px rgba(0, 255, 0, 0.7)', margin: '10px 0 0' }}>{loading ? 'Loading...' : meta.status || 'Waiting...'}</p>
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
