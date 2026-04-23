import React, { useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, Polyline, Rectangle, Polygon } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const GulfStreamMap = () => {
  const [startPos, setStartPos] = useState([38.9072, -77.0369]);
  const [routeData, setRouteData] = useState(null);
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(false);
  const [activeModel, setActiveModel] = useState('GFS');
  const [showWindStreamlines, setShowWindStreamlines] = useState(true);
  const [showCurrentHeatmap, setShowCurrentHeatmap] = useState(false);
  const [showSeaTemp, setShowSeaTemp] = useState(false);

  const modelSpread = {
    GFS: '±1.4 kt',
    ECMWF: '±0.9 kt',
    ICON: '±1.7 kt',
  };

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

  const parseWindDirection = (dir) => {
    const raw = String(dir || '').replace(/[^0-9.+-]/g, '');
    const value = parseFloat(raw);
    return Number.isFinite(value) ? value : 0;
  };

  const parseHeading = (value, fallback = 0) => {
    const raw = String(value || '').replace(/[^0-9.+-]/g, '');
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const getSailTrim = () => {
    const twa = parseFloat(String(meta.twa || '').replace(/[^0-9.+-]/g, '')) || 110;
    const tws = parseFloat(String(meta.tws || '').replace(/[^0-9.+-]/g, '')) || 18;

    if (twa >= 100 && twa <= 140 && tws >= 15) {
      return '130% Genoa - Pole to mast';
    }
    if (twa < 100) {
      return 'Code 0 / A2 - Outboard sheet';
    }
    return '100% Jib - Narrow sheeting';
  };

  const getPolarTarget = () => {
    const twa = parseFloat(String(meta.twa || '').replace(/[^0-9.+-]/g, '')) || 120;
    const tws = parseFloat(String(meta.tws || '').replace(/[^0-9.+-]/g, '')) || 18;
    const polar = {
      30: 0.38,
      45: 0.53,
      60: 0.66,
      75: 0.78,
      90: 0.88,
      105: 0.95,
      120: 1.00,
      135: 0.96,
      150: 0.90,
      165: 0.82,
      180: 0.70,
    };
    const keys = Object.keys(polar).map(Number).sort((a, b) => a - b);
    const clamp = Math.min(180, Math.max(0, twa));
    for (let i = 0; i < keys.length - 1; i += 1) {
      const low = keys[i];
      const high = keys[i + 1];
      if (clamp >= low && clamp <= high) {
        const ratio = (clamp - low) / (high - low);
        return tws * (polar[low] + (polar[high] - polar[low]) * ratio);
      }
    }
    return tws * polar[keys[keys.length - 1]];
  };

  const getEfficiency = () => {
    const actual = parseFloat(String(meta.vmg || '').replace(/[^0-9.+-]/g, '')) || 0;
    const target = getPolarTarget() || 1;
    return Math.round((actual / target) * 100);
  };

  const getCompassData = () => {
    const cog = parseHeading(meta.cog, 140);
    const opt = parseHeading(meta.opt_heading, 133);
    const delta = ((cog - opt + 540) % 360) - 180;
    return { cog, opt, delta };
  };

  const windBarbs = () => {
    const windDirValue = parseWindDirection(meta.wind_dir);
    const windSpeedValue = parseFloat(String(meta.wind_speed || '').replace(/[^0-9.+-]/g, '')) || 0;
    const bearing = ((windDirValue + 180) % 360) * Math.PI / 180;
    const arrowLength = 0.2 + windSpeedValue * 0.015;
    const dx = Math.sin(bearing) * arrowLength;
    const dy = Math.cos(bearing) * arrowLength;
    const headLength = arrowLength * 0.35;
    const headAngleA = bearing + Math.PI * 0.75;
    const headAngleB = bearing - Math.PI * 0.75;

    const grid = [
      [-2.0, -3.0], [-2.0, 0], [-2.0, 3.0],
      [0, -3.0], [0, 0], [0, 3.0],
      [2.0, -3.0], [2.0, 0], [2.0, 3.0],
    ];

    return grid.flatMap(([latOff, lonOff]) => {
      const start = [startPos[0] + latOff, startPos[1] + lonOff];
      const end = [start[0] + dy, start[1] + dx];
      const head1 = [end[0] + Math.cos(headAngleA) * headLength, end[1] + Math.sin(headAngleA) * headLength];
      const head2 = [end[0] + Math.cos(headAngleB) * headLength, end[1] + Math.sin(headAngleB) * headLength];
      return [
        { positions: [start, end] },
        { positions: [end, head1] },
        { positions: [end, head2] },
      ];
    });
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
        <h2 style={{ color: '#00ff00', fontSize: '1.4rem', marginTop: 0, marginBottom: '10px', fontFamily: 'monospace', letterSpacing: '2px' }}>MOMENTUM A2B</h2>

        <div style={{ display: 'grid', gap: '12px' }}>
          <div style={{ padding: '16px 14px', background: '#041204', borderRadius: '14px', border: '1px solid rgba(0,255,0,0.18)' }}>
            <p style={{ color: '#7f7f7f', margin: 0, fontSize: '0.75rem', letterSpacing: '1px' }}>FORECAST OPTIONS</p>
            <div style={{ display: 'grid', gap: '8px', marginTop: '12px' }}>
              {[
                { label: 'Wind Streamlines', value: showWindStreamlines, setter: setShowWindStreamlines },
                { label: 'Current Heatmap', value: showCurrentHeatmap, setter: setShowCurrentHeatmap },
                { label: 'Sea Temp', value: showSeaTemp, setter: setShowSeaTemp },
              ].map(({ label, value, setter }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setter(!value)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    width: '100%',
                    background: value ? 'rgba(0,255,0,0.14)' : '#011001',
                    border: value ? '1px solid #00ff00' : '1px solid rgba(255,255,255,0.08)',
                    color: value ? '#00ff00' : '#a8c0a0',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  <span style={{ fontSize: '0.92rem' }}>{label}</span>
                  <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>{value ? 'ON' : 'OFF'}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ padding: '18px', background: '#051205', borderRadius: '14px', boxShadow: '0 0 30px rgba(0, 255, 0, 0.18)' }}>
            <p style={{ color: '#7f7f7f', margin: 0, fontSize: '0.85rem', letterSpacing: '1px' }}>ENSEMBLE MODEL PICKER</p>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              {['GFS', 'ECMWF', 'ICON'].map((model) => (
                <button
                  key={model}
                  type="button"
                  onClick={() => setActiveModel(model)}
                  style={{
                    flex: 1,
                    border: activeModel === model ? '1px solid #00ff00' : '1px solid rgba(255,255,255,0.08)',
                    background: activeModel === model ? 'rgba(0,255,0,0.14)' : '#011001',
                    color: activeModel === model ? '#00ff00' : '#a8c0a0',
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    padding: '10px 8px',
                    borderRadius: '10px',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ fontSize: '0.95rem' }}>{model}</div>
                  <div style={{ fontSize: '0.72rem', color: '#7f7f7f', marginTop: '4px' }}>{modelSpread[model]}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ padding: '18px', background: '#051205', borderRadius: '14px', boxShadow: '0 0 30px rgba(0, 255, 0, 0.18)' }}>
            <p style={{ color: '#7f7f7f', margin: 0, fontSize: '0.85rem', letterSpacing: '1px' }}>GULF STREAM SLINGSHOT</p>
            <p style={{ fontSize: '2rem', fontWeight: 'bold', color: '#00ff00', fontFamily: 'monospace', letterSpacing: '1px', margin: '10px 0 0' }}>{meta.vmg ? `${meta.vmg}` : '-- kts'}</p>
            <p style={{ color: '#7f7f7f', margin: '10px 0 0', fontSize: '0.85rem' }}>Current Set / Drift</p>
            <p style={{ fontSize: '1rem', fontWeight: 700, color: '#00ff00', margin: '6px 0 0' }}>{meta.current_velocity ? `${meta.current_velocity} / ${meta.wind_dir || '--'}` : '-- / --'}</p>
          </div>

          <div style={{ padding: '18px', background: '#051205', borderRadius: '14px', boxShadow: '0 0 30px rgba(0, 255, 0, 0.18)' }}>
            <p style={{ color: '#7f7f7f', margin: 0, fontSize: '0.85rem', letterSpacing: '1px' }}>SAIL TRIM HUD</p>
            <p style={{ color: '#fff', margin: '10px 0 2px', fontSize: '0.95rem' }}>TWA {meta.twa || '--'} | TWS {meta.tws || '--'}</p>
            <p style={{ fontSize: '1.35rem', fontWeight: 'bold', color: '#00ff00', fontFamily: 'monospace', letterSpacing: '1px', margin: '8px 0 0' }}>{getSailTrim()}</p>
          </div>

          <div style={{ padding: '18px', background: '#051205', borderRadius: '14px', boxShadow: '0 0 30px rgba(0, 255, 0, 0.18)' }}>
            <p style={{ color: '#7f7f7f', margin: 0, fontSize: '0.85rem', letterSpacing: '1px' }}>EFFICIENCY</p>
            <p style={{ fontSize: '2rem', fontWeight: 'bold', color: getEfficiency() < 100 ? '#ff4d4d' : '#00ff00', fontFamily: 'monospace', letterSpacing: '2px', margin: '10px 0 0' }}>{getEfficiency()}%</p>
            <p style={{ color: '#7f7f7f', margin: '10px 0 0', fontSize: '0.85rem' }}>Actual SOG vs Polar Target</p>
          </div>

          <div style={{ padding: '18px', background: '#051205', borderRadius: '14px', boxShadow: '0 0 30px rgba(0, 255, 0, 0.18)' }}>
            <p style={{ color: '#7f7f7f', margin: 0, fontSize: '0.85rem', letterSpacing: '1px' }}>STATUS</p>
            <p style={{ fontSize: '1.6rem', fontWeight: 'bold', color: '#00ff00', fontFamily: 'monospace', letterSpacing: '1px', textShadow: '0 0 10px rgba(0, 255, 0, 0.7)', margin: '10px 0 0' }}>{loading ? 'Loading...' : meta.status || 'Waiting...'}</p>
          </div>
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
          {showWindStreamlines && meta.wind_speed && meta.wind_dir && windBarbs().map((barb, index) => (
            <Polyline
              key={`barb-${index}`}
              positions={barb.positions}
              color="rgba(0, 255, 0, 0.45)"
              weight={2}
              opacity={0.55}
            />
          ))}
          {showCurrentHeatmap && (
            <> 
              <Rectangle bounds={[[33.5, -75.5], [34.2, -73.5]]} pathOptions={{ color: 'rgba(255,0,0,0.05)', fillColor: 'rgba(255,0,0,0.18)', fillOpacity: 0.18, weight: 0 }} />
              <Rectangle bounds={[[32.7, -72.8], [33.3, -71.2]]} pathOptions={{ color: 'rgba(0,0,255,0.05)', fillColor: 'rgba(0,0,255,0.18)', fillOpacity: 0.18, weight: 0 }} />
            </>
          )}
          {showSeaTemp && (
            <Polygon
              pathOptions={{ color: 'rgba(0,255,0,0.35)', dashArray: '6,8', weight: 3 }}
              positions={[[33.9, -76.2], [33.6, -74.5], [33.3, -72.8], [33.0, -71.2]]}
            />
          )}
        </MapContainer>
        <div style={{ position: 'absolute', bottom: '24px', right: '24px', width: '180px', height: '180px', borderRadius: '50%', background: 'rgba(1, 10, 5, 0.9)', border: '1px solid rgba(0,255,0,0.24)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 40px rgba(0,255,0,0.2)', padding: '16px' }}>
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.08)' }} />
            <div style={{ position: 'absolute', inset: '50% 0 0 0', height: '1px', background: 'rgba(255,255,255,0.18)' }} />
            <div style={{ position: 'absolute', inset: '0 50% 0 0', width: '1px', background: 'rgba(255,255,255,0.18)' }} />
            <div style={{ position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)', fontSize: '0.7rem', color: '#7f7f7f' }}>N</div>
            <div style={{ position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)', fontSize: '0.7rem', color: '#7f7f7f' }}>S</div>
            <div style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.7rem', color: '#7f7f7f' }}>W</div>
            <div style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.7rem', color: '#7f7f7f' }}>E</div>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ position: 'absolute', width: '4px', height: '80px', background: 'rgba(0,255,0,0.75)', transform: `rotate(${getCompassData().cog}deg) translateY(-22px)`, transformOrigin: 'center bottom' }} />
              <div style={{ position: 'absolute', width: '4px', height: '60px', background: 'rgba(0,255,0,0.4)', transform: `rotate(${getCompassData().opt}deg) translateY(-18px)`, transformOrigin: 'center bottom' }} />
              <div style={{ position: 'absolute', bottom: '16px', left: '50%', transform: 'translateX(-50%)', textAlign: 'center' }}>
                <div style={{ color: '#00ff00', fontSize: '0.8rem', fontWeight: '700' }}>COG {meta.cog || '--'}</div>
                <div style={{ color: '#7f7f7f', fontSize: '0.7rem' }}>OPT {meta.opt_heading || '--'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GulfStreamMap;
