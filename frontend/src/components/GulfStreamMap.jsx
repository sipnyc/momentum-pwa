import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap, Polyline, Rectangle, Polygon } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const GulfStreamMap = () => {
  const [startPos, setStartPos] = useState([38.9072, -77.0369]);
  const [routeData, setRouteData] = useState(null);
  const [meta, setMeta] = useState({});
  const [windField, setWindField] = useState([]);
  const [currentZones, setCurrentZones] = useState([]);
  const [seaTempData, setSeaTempData] = useState(null);
  const [forecastHours] = useState([0, 3, 6, 9, 12, 15, 18, 21, 24]);
  const [forecastHour, setForecastHour] = useState(0);
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
        body: JSON.stringify({ lat, lon, forecast_hour: forecastHour })
      });
      const data = await response.json();
      setRouteData(data.points);
      setMeta(data.metadata || {});
      setWindField((data.metadata && data.metadata.wind_field) || []);
      setCurrentZones((data.metadata && data.metadata.current_field && data.metadata.current_field.zones) || []);
      setSeaTempData((data.metadata && data.metadata.sea_temp) || null);
    } catch (err) {
      console.error("Link to Brain failed", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoute(startPos[0], startPos[1]);
  }, [activeModel, forecastHour]);

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

  const normalizeWindField = () => {
    if (windField && windField.length > 0) {
      return windField.filter((point) => point && typeof point.lat === 'number' && typeof point.lon === 'number');
    }

    const windDirValue = parseWindDirection(meta.wind_dir);
    const windSpeedValue = parseFloat(String(meta.wind_speed || '').replace(/[^0-9.+-]/g, '')) || 0;
    const angle = ((windDirValue + 180) % 360) * Math.PI / 180;
    const u = Math.sin(angle) * windSpeedValue;
    const v = Math.cos(angle) * windSpeedValue;
    return [{ lat: startPos[0], lon: startPos[1], u, v }];
  };

  const currentSpeedColor = (speed, pulse) => {
    if (speed <= 1) return 'rgba(40, 112, 255, 0.10)';
    if (speed <= 2) return 'rgba(34, 197, 94, 0.16)';
    const alpha = 0.24 + pulse * 0.12;
    return `rgba(255, 35, 72, ${alpha})`;
  };

  const temperatureGradientColor = (temp) => {
    if (temp <= 20) return 'rgba(128, 0, 128, 0.24)';
    if (temp >= 25) return 'rgba(255, 85, 0, 0.20)';
    const mid = (temp - 20) / 5;
    return `rgba(${Math.round(255 * mid + 128 * (1 - mid))}, ${Math.round(85 * mid)}, ${Math.round(128 * (1 - mid))}, 0.18)`;
  };

  const WindStreamlineOverlay = ({ active }) => {
    const map = useMap();
    const canvasRef = useRef(null);
    const frameRef = useRef(null);
    const particlesRef = useRef([]);

    useEffect(() => {
      if (!active || !map) return undefined;
      const canvas = document.createElement('canvas');
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = 450;
      map.getPanes().overlayPane.appendChild(canvas);
      canvasRef.current = canvas;

      const field = normalizeWindField();
      const particles = field.flatMap((point, index) => {
        const speed = Math.sqrt(point.u * point.u + point.v * point.v) || 2;
        const angle = Math.atan2(-point.v, point.u);
        const baseSpeed = Math.max(0.6, Math.min(3.8, speed * 0.16));
        const color = speed > 14 ? 'rgba(255, 100, 60, 0.9)' : speed > 8 ? 'rgba(125, 211, 252, 0.88)' : 'rgba(99, 102, 241, 0.76)';
        return Array.from({ length: 20 }, () => ({
          lat: point.lat + (Math.random() - 0.5) * 0.45,
          lon: point.lon + (Math.random() - 0.5) * 0.45,
          angle,
          baseSpeed,
          color,
          length: 22 + Math.random() * 12,
          xOffset: (Math.random() - 0.5) * 30,
          yOffset: (Math.random() - 0.5) * 30,
          alpha: 0.16 + Math.random() * 0.36,
        }));
      });
      particlesRef.current = particles;

      const resizeCanvas = () => {
        const size = map.getSize();
        canvas.width = size.x;
        canvas.height = size.y;
        canvas.style.width = `${size.x}px`;
        canvas.style.height = `${size.y}px`;
      };

      const animate = () => {
        if (!canvasRef.current || !map) return;
        resizeCanvas();
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.globalCompositeOperation = 'lighter';
          ctx.lineCap = 'round';

          const timeFactor = 0.55 + 0.45 * Math.sin((forecastHour / 24) * Math.PI);
          particlesRef.current.forEach((particle) => {
            const latLng = L.latLng(particle.lat, particle.lon);
            const start = map.latLngToContainerPoint(latLng);
            const px = start.x + particle.xOffset;
            const py = start.y + particle.yOffset;
            const speed = particle.baseSpeed * timeFactor;
            const xEnd = px + Math.cos(particle.angle) * speed * particle.length;
            const yEnd = py + Math.sin(particle.angle) * speed * particle.length;

            ctx.strokeStyle = particle.color;
            ctx.lineWidth = 2;
            ctx.globalAlpha = particle.alpha * 0.65;
            ctx.shadowBlur = 12;
            ctx.shadowColor = particle.color;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(xEnd, yEnd);
            ctx.stroke();
            ctx.shadowBlur = 0;
          });

          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
      return () => {
        map.off('move resize zoom', resizeCanvas);
        if (canvas && canvas.parentNode) {
          canvas.parentNode.removeChild(canvas);
        }
        if (frameRef.current) {
          cancelAnimationFrame(frameRef.current);
        }
      };
    }, [map, active, forecastHour, windField, meta]);

    return null;
  };

  const WeatherHeatmapOverlay = ({ showCurrent, showTemp }) => {
    const map = useMap();
    const canvasRef = useRef(null);

    useEffect(() => {
      if (!map) return undefined;
      const canvas = document.createElement('canvas');
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = 420;
      map.getPanes().overlayPane.appendChild(canvas);
      canvasRef.current = canvas;

      const resizeCanvas = () => {
        const size = map.getSize();
        canvas.width = size.x;
        canvas.height = size.y;
        canvas.style.width = `${size.x}px`;
        canvas.style.height = `${size.y}px`;
      };

      const drawHeatmap = () => {
        if (!canvasRef.current || !map) return;
        resizeCanvas();
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (showTemp && seaTempData) {
          const avgTemp = ((seaTempData.min_temp || 20) + (seaTempData.max_temp || 25)) / 2;
          ctx.fillStyle = temperatureGradientColor(avgTemp);
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          if (seaTempData.isotherms) {
            seaTempData.isotherms.forEach((isotherm) => {
              if (!isotherm.bounds || isotherm.bounds.length < 3) return;
              ctx.beginPath();
              isotherm.bounds.forEach((coord, index) => {
                const point = map.latLngToContainerPoint(L.latLng(coord[0], coord[1]));
                if (index === 0) ctx.moveTo(point.x, point.y);
                else ctx.lineTo(point.x, point.y);
              });
              ctx.closePath();
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
              ctx.lineWidth = 2;
              ctx.setLineDash([8, 10]);
              ctx.stroke();
              ctx.setLineDash([]);
            });
          }
        }

        if (showCurrent && currentZones && currentZones.length > 0) {
          currentZones.forEach((zone) => {
            if (!zone.bounds || zone.bounds.length < 2) return;
            const intensity = Math.min(1, Math.max(0, zone.intensity || 0.25));
            const speed = intensity * 5;
            const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 300);
            const color = currentSpeedColor(speed, pulse);
            const coords = zone.bounds.map((coord) => map.latLngToContainerPoint(L.latLng(coord[0], coord[1])));
            const centroid = coords.reduce((acc, pt) => ({ x: acc.x + pt.x, y: acc.y + pt.y }), { x: 0, y: 0 });
            centroid.x /= coords.length; centroid.y /= coords.length;
            const radius = Math.max(...coords.map((pt) => Math.hypot(pt.x - centroid.x, pt.y - centroid.y))) * 1.1;
            const gradient = ctx.createRadialGradient(centroid.x, centroid.y, radius * 0.1, centroid.x, centroid.y, radius);
            gradient.addColorStop(0, color);
            gradient.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.beginPath();
            coords.forEach((point, index) => {
              if (index === 0) ctx.moveTo(point.x, point.y);
              else ctx.lineTo(point.x, point.y);
            });
            ctx.closePath();
            ctx.fillStyle = gradient;
            ctx.fill();
          });
        }
      };

      const update = () => drawHeatmap();
      map.on('move resize zoom', update);
      update();

      return () => {
        map.off('move resize zoom', update);
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      };
    }, [map, showCurrent, showTemp, currentZones, seaTempData, forecastHour]);

    return null;
  };

  const windBarbs = () => {
    const field = (windField && Array.isArray(windField) ? windField : []).filter((point) => point && typeof point.lat === 'number');
    const timeFactor = 0.7 + 0.3 * Math.sin((forecastHour / 24) * Math.PI);

    if (field.length === 0) {
      const windDirValue = parseWindDirection(meta.wind_dir);
      const windSpeedValue = parseFloat(String(meta.wind_speed || '').replace(/[^0-9.+-]/g, '')) || 0;
      const bearing = ((windDirValue + 180) % 360) * Math.PI / 180;
      const scaledSpeed = windSpeedValue * timeFactor;
      const arrowLength = 0.18 + scaledSpeed * 0.015;
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
          { positions: [start, end], color: '#7dd3fc', weight: 2 },
          { positions: [end, head1], color: '#7dd3fc', weight: 2 },
          { positions: [end, head2], color: '#7dd3fc', weight: 2 },
        ];
      });
    }

    return field.flatMap((point) => {
      const u = point.u || 0;
      const v = point.v || 0;
      const windSpeed = Math.sqrt(u * u + v * v) * timeFactor;
      const windDir = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
      const bearing = ((windDir + 180) % 360) * Math.PI / 180;
      const arrowLength = 0.18 + Math.min(windSpeed, 30) * 0.01;
      const dx = Math.sin(bearing) * arrowLength;
      const dy = Math.cos(bearing) * arrowLength;
      const headLength = arrowLength * 0.35;
      const headAngleA = bearing + Math.PI * 0.75;
      const headAngleB = bearing - Math.PI * 0.75;
      const color = windSpeed > 18 ? '#ff9f43' : windSpeed > 10 ? '#7dd3fc' : '#93c5fd';

      const start = [point.lat, point.lon];
      const end = [start[0] + dy, start[1] + dx];
      const head1 = [end[0] + Math.cos(headAngleA) * headLength, end[1] + Math.sin(headAngleA) * headLength];
      const head2 = [end[0] + Math.cos(headAngleB) * headLength, end[1] + Math.sin(headAngleB) * headLength];
      return [
        { positions: [start, end], color, weight: 2 },
        { positions: [end, head1], color, weight: 2 },
        { positions: [end, head2], color, weight: 2 },
      ];
    });
  };

  const currentHeatmapLayers = () => currentZones.map((zone, idx) => {
    if (!zone || !zone.bounds || zone.bounds.length < 2) return null;
    const intensity = Math.min(1, Math.max(0, zone.intensity || 0.3));
    const timeIntensity = intensity * (0.75 + 0.25 * Math.cos((forecastHour / 24) * Math.PI));
    const fillColor = timeIntensity > 0.6 ? '#ff4d4d' : timeIntensity > 0.45 ? '#ff9a56' : '#4d8cff';
    const fillOpacity = 0.16 + timeIntensity * 0.28;
    const pathOptions = { color: fillColor, fillColor, fillOpacity, weight: 0 };

    return zone.bounds.length > 2 ? (
      <Polygon key={`current-zone-${idx}`} positions={zone.bounds} pathOptions={pathOptions} />
    ) : (
      <Rectangle key={`current-zone-${idx}`} bounds={zone.bounds} pathOptions={pathOptions} />
    );
  });

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
          <WindStreamlineOverlay active={showWindStreamlines} />
          <WeatherHeatmapOverlay showCurrent={showCurrentHeatmap} showTemp={showSeaTemp} />
        </MapContainer>
        <div
          style={{
            position: 'absolute',
            bottom: 18,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            width: 'calc(100% - 40px)',
            maxWidth: '560px',
            background: 'rgba(4, 10, 8, 0.88)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '18px',
            padding: '14px 16px',
            color: '#d8f3ff',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.35)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '0.92rem', fontWeight: 700 }}>Forecast scrubber +{forecastHour}h</div>
            <div style={{ fontSize: '0.8rem', color: '#93c5fd' }}>U/V velocity & current heatmap layers</div>
          </div>
          <input
            type="range"
            min="0"
            max="24"
            step="3"
            value={forecastHour}
            onChange={(e) => setForecastHour(Number(e.target.value))}
            style={{ width: '100%', marginTop: '12px' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8', marginTop: '8px' }}>
            {forecastHours.map((hour) => (
              <span key={hour}>{hour}h</span>
            ))}
          </div>
        </div>
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
