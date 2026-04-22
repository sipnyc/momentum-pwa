import React, { useState } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const GulfStreamMap = () => {
  const [startPos, setStartPos] = useState([38.9072, -77.0369]);
  const [route, setRoute] = useState([]);

  // Magic bridge for iPad to find the Python Brain
  const API_BASE = window.location.origin.replace('-5173', '-8000');

  const MapEvents = () => {
    useMapEvents({
      contextmenu: (e) => {
        setStartPos([e.latlng.lat, e.latlng.lng]);
        console.log("App requested routing for:", e.latlng);
        // We will add the fetch logic here in Stage 2
      },
    });
    return null;
  };

  return (
    <div style={{ height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <MapContainer center={startPos} zoom={6} style={{ height: '100%', width: '100%' }} zoomControl={false}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <MapEvents />
        <Marker position={startPos} />
        {route.length > 0 && <Polyline positions={route} color="cyan" />}
      </MapContainer>
    </div>
  );
};

export default GulfStreamMap;
