import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap, Polyline, Rectangle, Polygon } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const computeWindGrid = (field, bounds = [[33.6, -79.0], [39.8, -63.8]]) => {
  const rows = 16;
  const cols = 24;
  const points = [];
  const latRange = bounds[1][0] - bounds[0][0];
  const lonRange = bounds[1][1] - bounds[0][1];

  for (let i = 0; i < rows; i += 1) {
    const lat = bounds[0][0] + (latRange * i) / (rows - 1);
    for (let j = 0; j < cols; j += 1) {
      const lon = bounds[0][1] + (lonRange * j) / (cols - 1);
      const nearest = field.reduce((best, item) => {
        const dist = ((item.lat - lat) ** 2) + ((item.lon - lon) ** 2);
        return dist < best.dist ? { item, dist } : best;
      }, { item: field[0], dist: Infinity }).item;
      points.push({ lat, lon, u: nearest.u || 0, v: nearest.v || 0 });
    }
  }

  return points;
};

const currentSpeedColor = (speed, pulse) => {
  const alpha = 0.25 + pulse * 0.18;
  if (speed <= 0.4) return `rgba(20, 60, 255, ${alpha})`;
  if (speed <= 1.0) return `rgba(40, 160, 255, ${alpha})`;
  if (speed <= 1.8) return `rgba(255, 180, 0, ${alpha})`;
  return `rgba(255, 20, 60, ${alpha})`;
};

const temperatureGradientColor = (temp) => {
  if (temp <= 19) return 'rgba(40, 112, 255, 0.22)';
  if (temp >= 26) return 'rgba(255, 40, 40, 0.24)';
  const ratio = (temp - 19) / 7;
  const r = Math.round(40 + (255 - 40) * ratio);
  const g = Math.round(112 - 72 * ratio);
  const b = Math.round(255 - 215 * ratio);
  return `rgba(${r}, ${g}, ${b}, 0.20)`;
};

const WindStreamlineOverlay = ({ active, forecastHour, windGrid }) => {
  const map = useMap();
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const particlesRef = useRef([]);

  useEffect(() => {
    if (!active || !map || !windGrid || windGrid.length === 0) return undefined;
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = 450;
    map.getPanes().overlayPane.appendChild(canvas);
    canvasRef.current = canvas;

    const particles = windGrid.flatMap((point) => {
      const speed = Math.sqrt(point.u * point.u + point.v * point.v) || 2;
      const angle = Math.atan2(-point.v, point.u);
      const baseSpeed = Math.max(0.6, Math.min(4.6, speed * 0.14));
      const color = speed > 18 ? 'rgba(255, 50, 20, 0.98)' : speed > 12 ? 'rgba(255, 160, 40, 0.95)' : speed > 7 ? 'rgba(80, 220, 255, 0.92)' : 'rgba(99, 102, 241, 0.82)';
      return Array.from({ length: 20 }, () => ({
        lat: point.lat + (Math.random() - 0.5) * 2.2,
        lon: point.lon + (Math.random() - 0.5) * 2.2,
        u: point.u,
        v: point.v,
        angle,
        baseSpeed,
        color,
        length: 20 + Math.random() * 22,
        xOffset: (Math.random() - 0.5) * 38,
        yOffset: (Math.random() - 0.5) * 38,
        alpha: 0.18 + Math.random() * 0.55,
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

      // timeFactor builds from 0.6 at t=0 to 1.4 at t=120h with a diurnal ripple
      const timeFactor = 0.6 + 0.8 * (forecastHour / 120) + 0.15 * Math.sin((forecastHour / 24) * Math.PI);
      particlesRef.current.forEach((particle) => {
        particle.lat += particle.v * 0.0018 * timeFactor;
        particle.lon += particle.u * 0.0018 * timeFactor / Math.max(Math.cos(particle.lat * Math.PI / 180), 0.05);
        const latLng = L.latLng(particle.lat, particle.lon);
        const start = map.latLngToContainerPoint(latLng);
        const px = start.x + particle.xOffset;
        const py = start.y + particle.yOffset;
        const speed = particle.baseSpeed * timeFactor * (0.9 + Math.min(0.3, Math.sqrt(particle.u * particle.u + particle.v * particle.v) * 0.04));
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
      frameRef.current = requestAnimationFrame(animate);
    };

    map.on('move resize zoom', resizeCanvas);
    animate();

    return () => {
      map.off('move resize zoom', resizeCanvas);
      if (canvas && canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [map, active, forecastHour, windGrid]);

  return null;
};

const WeatherHeatmapOverlay = ({ showCurrent, showTemp, currentZones, seaTempData, forecastHour }) => {
  const map = useMap();
  const canvasRef = useRef(null);
  const frameRef = useRef(null);

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

    const resize = () => {
      const s = map.getSize();
      canvas.width = s.x; canvas.height = s.y;
      canvas.style.width = `${s.x}px`; canvas.style.height = `${s.y}px`;
    };

    // GS meander shifts slightly with forecast time (±0.5° over 120 h)
    const gsMeanderLat = (lon) => 37.0 - (lon + 73.0) * 0.28 + 0.5 * Math.sin((forecastHour / 120) * Math.PI);

    const zoneColor = (speed, pulse, timeMod) => {
      const s = Math.min(speed * timeMod, 3.5);
      if (s >= 2.8) return `rgba(255,${Math.round(10 + 30 * pulse)},30,${0.30 + pulse * 0.14})`;
      if (s >= 1.8) return `rgba(255,${Math.round(120 - 80 * ((s - 1.8) / 1.0))},20,${0.24 + pulse * 0.10})`;
      if (s >= 0.8) return `rgba(255,${Math.round(200 - 80 * ((s - 0.8) / 1.0))},60,${0.18 + pulse * 0.08})`;
      return `rgba(${Math.round(20 + 30 * (s / 0.8))},${Math.round(60 + 60 * (s / 0.8))},${Math.round(200 + 55 * (s / 0.8))},${0.20 + pulse * 0.08})`;
    };

    const draw = () => {
      if (!canvasRef.current || !map) return;
      resize();
      const ctx = canvasRef.current.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (showTemp && seaTempData) {
        const avg = ((seaTempData.min_temp || 20) + (seaTempData.max_temp || 25)) / 2;
        ctx.fillStyle = temperatureGradientColor(avg);
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      if (showCurrent && currentZones && currentZones.length > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 900);
        const timeMod = 0.75 + 0.5 * (forecastHour / 120);

        // ── Zone blobs ─────────────────────────────────────────────
        currentZones.forEach((zone) => {
          if (!zone.bounds || zone.bounds.length < 2) return;
          const intensity = Math.min(1, Math.max(0, zone.intensity || 0.25));
          const speed = intensity * 3.5;
          const color = zoneColor(speed, pulse, timeMod);
          const coords = zone.bounds.map((c) => map.latLngToContainerPoint(L.latLng(c[0], c[1])));
          const cx = coords.reduce((a, p) => a + p.x, 0) / coords.length;
          const cy = coords.reduce((a, p) => a + p.y, 0) / coords.length;
          const r = Math.max(...coords.map((p) => Math.hypot(p.x - cx, p.y - cy))) * 1.5;
          const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
          g.addColorStop(0, color);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.beginPath();
          coords.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
          ctx.closePath();
          ctx.fillStyle = g;
          ctx.fill();
        });

        // ── Cold Wall – bright cyan/white boundary line ─────────────
        ctx.beginPath();
        ctx.setLineDash([12, 8]);
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 14;
        ctx.shadowColor = 'rgba(0, 230, 255, 0.9)';
        ctx.strokeStyle = `rgba(0,230,255,${0.55 + pulse * 0.30})`;
        let wallStarted = false;
        for (let lon = -78; lon <= -62; lon += 0.5) {
          const lat = gsMeanderLat(lon) + 1.4;
          const pt = map.latLngToContainerPoint(L.latLng(lat, lon));
          if (!wallStarted) { ctx.moveTo(pt.x, pt.y); wallStarted = true; }
          else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.setLineDash([]);

        // ── GS core centerline glow ────────────────────────────────
        ctx.beginPath();
        ctx.lineWidth = 4;
        ctx.shadowBlur = 20;
        ctx.shadowColor = `rgba(255,40,0,${0.6 + pulse * 0.3})`;
        ctx.strokeStyle = `rgba(255,80,20,${0.35 + pulse * 0.20})`;
        let coreStarted = false;
        for (let lon = -78; lon <= -62; lon += 0.5) {
          const lat = gsMeanderLat(lon);
          const pt = map.latLngToContainerPoint(L.latLng(lat, lon));
          if (!coreStarted) { ctx.moveTo(pt.x, pt.y); coreStarted = true; }
          else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      frameRef.current = requestAnimationFrame(draw);
    };

    map.on('move resize zoom', resize);
    draw();

    return () => {
      map.off('move resize zoom', resize);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, [map, showCurrent, showTemp, currentZones, seaTempData, forecastHour]);

  return null;
};

const IsochroneFans = ({ fans, startPos }) => {
  if (!fans || fans.length === 0) return null;
  const strokeColors = ['#00ffc8', '#00aaff', '#aa66ff'];
  const fillColors = ['rgba(0,255,200,0.07)', 'rgba(0,170,255,0.05)', 'rgba(170,100,255,0.04)'];
  return fans.map((fan, idx) => {
    if (!fan || fan.length < 3) return null;
    const sorted = [...fan].sort((a, b) => {
      const ba = Math.atan2(a[1] - startPos[1], a[0] - startPos[0]);
      const bb = Math.atan2(b[1] - startPos[1], b[0] - startPos[0]);
      return ba - bb;
    });
    return (
      <Polygon
        key={`fan-${idx}`}
        positions={sorted}
        pathOptions={{
          color: strokeColors[idx] || '#888',
          fillColor: fillColors[idx] || 'transparent',
          fillOpacity: 1,
          weight: 1.5,
          opacity: 0.7,
          dashArray: '5 7',
        }}
      />
    );
  });
};

const MapEvents = ({ onSetStart }) => {
  useMapEvents({
    click: (e) => onSetStart([e.latlng.lat, e.latlng.lng]),
    contextmenu: (e) => onSetStart([e.latlng.lat, e.latlng.lng])
  });
  return null;
};

const GulfStreamMap = () => {
  const [startPos, setStartPos] = useState([38.9784, -76.4922]);
  const [routeData, setRouteData] = useState(null);
  const [endPos, setEndPos] = useState([32.3078, -64.7505]);
  const noRoute = !routeData || routeData.length < 2;
  const routeBounds = [
    [Math.min(startPos[0], endPos[0]) - 2.2, Math.min(startPos[1], endPos[1]) - 2.2],
    [Math.max(startPos[0], endPos[0]) + 2.2, Math.max(startPos[1], endPos[1]) + 2.2],
  ];
  const routeCenter = [
    (startPos[0] + endPos[0]) / 2,
    (startPos[1] + endPos[1]) / 2,
  ];
  const [meta, setMeta] = useState({});
  const [windField, setWindField] = useState([]);
  const [currentField, setCurrentField] = useState({ vectors: [] });
  const [currentZones, setCurrentZones] = useState([]);
  const [seaTempData, setSeaTempData] = useState(null);
  const [forecastHours] = useState([0, 24, 48, 72, 96, 120]);
  const [forecastHour, setForecastHour] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeModel, setActiveModel] = useState('GFS');
  const [showWindStreamlines, setShowWindStreamlines] = useState(true);
  const [showCurrentHeatmap, setShowCurrentHeatmap] = useState(false);
  const [showSeaTemp, setShowSeaTemp] = useState(false);
  const [isochroneFans, setIsochroneFans] = useState([]);
  const [bias, setBias] = useState(1.0);

  const modelSpread = {
    GFS: '±1.4 kt',
    ECMWF: '±0.9 kt',
    ICON: '±1.7 kt',
  };

  const API_BASE = window.location.origin.includes('5173')
    ? window.location.origin.replace('5173', '8000')
    : 'http://localhost:8000';

  const fetchRoute = async (startLat, startLon, finishLat, finishLon) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/isochrone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_lat: startLat, start_lon: startLon, end_lat: finishLat, end_lon: finishLon, forecast_hour: forecastHour, bias })
      });
      const data = await response.json();
      setRouteData(Array.isArray(data.points) ? data.points : []);
      setIsochroneFans(data.isochrone_fans || []);
      setMeta(data.metadata || {});
      setWindField((data.metadata && data.metadata.wind_field) || []);
      setCurrentField((data.metadata && data.metadata.current_field) || { vectors: [] });
      setCurrentZones((data.metadata && data.metadata.current_field && data.metadata.current_field.zones) || []);
      setSeaTempData((data.metadata && data.metadata.sea_temp) || null);
    } catch (err) {
      console.error("Link to Brain failed", err);
      setRouteData([]);
      setIsochroneFans([]);
      setMeta({ status: 'Route request failed' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoute(startPos[0], startPos[1], endPos[0], endPos[1]);
  }, [activeModel, forecastHour, startPos, endPos, bias]);

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
    if (meta.sail_trim && meta.sail_trim.sails) return meta.sail_trim.sails;
    const twa = parseFloat(String(meta.twa || '').replace(/[^0-9.+-]/g, '')) || 110;
    const tws = parseFloat(String(meta.tws || '').replace(/[^0-9.+-]/g, '')) || 18;
    if (twa >= 100 && twa < 135 && tws >= 10) return 'Main + A2 Spinnaker (optimal angle)';
    if (twa >= 135 && tws >= 8) return 'Main + A3 Runner Spinnaker';
    if (twa >= 80) return 'Main + 150% Genoa (sheet eased)';
    if (twa >= 45) return 'Main + 130% Genoa (leads aft 1 notch)';
    return 'Main + 100% Jib (pinned hard)';
  };

  const getSailMode = () => (meta.sail_trim && meta.sail_trim.mode) || 'Reaching';

  const getRecommendedBearing = () => {
    const heading = parseHeading(meta.vmc_heading, parseHeading(meta.opt_heading, 0));
    return heading;
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

  const windGrid = computeWindGrid(normalizeWindField());

  const windBarbs = () => {
    const field = normalizeWindField();
    const grid = computeWindGrid(field);
    const timeFactor = 0.7 + 0.3 * Math.sin((forecastHour / 24) * Math.PI);

    return grid.flatMap((point) => {
      const u = point.u || 0;
      const v = point.v || 0;
      const windSpeed = Math.sqrt(u * u + v * v) * timeFactor;
      const windDir = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
      const bearing = ((windDir + 180) % 360) * Math.PI / 180;
      const arrowLength = 0.25 + Math.min(windSpeed, 28) * 0.012;
      const dx = Math.sin(bearing) * arrowLength;
      const dy = Math.cos(bearing) * arrowLength;
      const headLength = arrowLength * 0.38;
      const headAngleA = bearing + Math.PI * 0.75;
      const headAngleB = bearing - Math.PI * 0.75;
      const color = windSpeed > 18 ? '#ffb347' : windSpeed > 10 ? '#7dd3fc' : '#93c5fd';

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

  const currentHeatmapLayers = () => {
    const maxIntensity = currentZones.reduce((max, zone) => Math.max(max, zone?.intensity || 0), 0);
    return currentZones.map((zone, idx) => {
      if (!zone || !zone.bounds || zone.bounds.length < 2) return null;
      const intensity = Math.min(1, Math.max(0, zone.intensity || 0.3));
      const isFastest = zone.intensity === maxIntensity;
      const timeIntensity = intensity * (0.75 + 0.25 * Math.cos((forecastHour / 24) * Math.PI));
      const fillColor = isFastest ? 'rgba(255, 34, 34, 0.28)' : timeIntensity > 0.6 ? '#ff4d4d' : timeIntensity > 0.45 ? '#ff9a56' : '#4d8cff';
      const pathOptions = {
        color: isFastest ? '#ff0000' : fillColor,
        fillColor,
        fillOpacity: isFastest ? 0.32 : 0.18,
        weight: isFastest ? 2 : 0,
        dashArray: isFastest ? '6 8' : undefined,
      };

      return zone.bounds.length > 2 ? (
        <Polygon key={`current-zone-${idx}`} positions={zone.bounds} pathOptions={pathOptions} />
      ) : (
        <Rectangle key={`current-zone-${idx}`} bounds={zone.bounds} pathOptions={pathOptions} />
      );
    });
  };

  return (
    <div className="app-container">
      {/* TACTICAL HUD SIDEBAR */}
      <div className="dashboard-side" style={{ width: '380px' }}>
        <h2 style={{ color: '#00ff00', fontSize: '1.4rem', marginTop: 0, marginBottom: '10px', fontFamily: 'monospace', letterSpacing: '2px' }}>MOMENTUM A2B</h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div style={{ gridColumn: 'span 2', padding: '16px 14px', background: '#041204', borderRadius: '14px', border: '1px solid rgba(0,255,0,0.18)' }}>
            <p style={{ color: '#7f7f7f', margin: 0, fontSize: '0.75rem', letterSpacing: '1px' }}>ROUTE INPUT</p>
            <div style={{ display: 'grid', gap: '10px', marginTop: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <label style={{ display: 'grid', gap: '4px', color: '#a8c0a0', fontSize: '0.78rem' }}>
                  Start Lat
                  <input
                    type="number"
                    step="0.0001"
                    value={startPos[0]}
                    onChange={(e) => setStartPos([Number(e.target.value), startPos[1]])}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.12)', background: '#011001', color: '#d8f3ff' }}
                  />
                </label>
                <label style={{ display: 'grid', gap: '4px', color: '#a8c0a0', fontSize: '0.78rem' }}>
                  Start Lon
                  <input
                    type="number"
                    step="0.0001"
                    value={startPos[1]}
                    onChange={(e) => setStartPos([startPos[0], Number(e.target.value)])}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.12)', background: '#011001', color: '#d8f3ff' }}
                  />
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <label style={{ display: 'grid', gap: '4px', color: '#a8c0a0', fontSize: '0.78rem' }}>
                  End Lat
                  <input
                    type="number"
                    step="0.0001"
                    value={endPos[0]}
                    onChange={(e) => setEndPos([Number(e.target.value), endPos[1]])}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.12)', background: '#011001', color: '#d8f3ff' }}
                  />
                </label>
                <label style={{ display: 'grid', gap: '4px', color: '#a8c0a0', fontSize: '0.78rem' }}>
                  End Lon
                  <input
                    type="number"
                    step="0.0001"
                    value={endPos[1]}
                    onChange={(e) => setEndPos([endPos[0], Number(e.target.value)])}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.12)', background: '#011001', color: '#d8f3ff' }}
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => fetchRoute(startPos[0], startPos[1], endPos[0], endPos[1])}
                style={{ marginTop: '8px', padding: '10px 14px', borderRadius: '12px', border: '1px solid #00ff00', background: '#011001', color: '#00ff00', fontFamily: 'monospace', fontWeight: 700, cursor: 'pointer' }}
              >
                Recompute Route
              </button>
              <div style={{ marginTop: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a8c0a0', fontSize: '0.78rem', marginBottom: '4px' }}>
                  <span>Polar Bias (onboard vs theory)</span>
                  <span style={{ color: bias < 1.0 ? '#ff7f50' : '#00ff00', fontWeight: 700 }}>{Math.round(bias * 100)}%</span>
                </div>
                <input
                  type="range" min="0.70" max="1.05" step="0.01" value={bias}
                  onChange={(e) => setBias(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#00ff00' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#555' }}>
                  <span>70%</span><span>85%</span><span>100%</span>
                </div>
              </div>
            </div>
          </div>

          <div style={{ gridColumn: 'span 2', padding: '16px 14px', background: '#041204', borderRadius: '14px', border: '1px solid rgba(0,255,0,0.18)' }}>
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
            <p style={{ fontSize: '0.72rem', color: '#7f7f7f', margin: '6px 0 0' }}>CURRENT PROFIT</p>
            <p style={{ fontSize: '2.2rem', fontWeight: 'bold', color: meta.gs_current_kts > 0.5 ? '#00ff00' : '#7f7f7f', fontFamily: 'monospace', letterSpacing: '1px', margin: '2px 0 0', textShadow: meta.gs_current_kts > 0.5 ? '0 0 18px rgba(0,255,0,0.6)' : 'none' }}>
              {meta.gs_current_kts != null ? `+${meta.gs_current_kts} kt` : '-- kt'}
            </p>
            <p style={{ color: '#7f7f7f', margin: '10px 0 0', fontSize: '0.75rem', letterSpacing: '1px' }}>ETA</p>
            <p style={{ fontSize: '1.1rem', fontWeight: 700, color: '#7bdfff', margin: '2px 0 0' }}>{meta.eta_adjusted_h ? `${meta.eta_adjusted_h} h` : '--'}</p>
            <p style={{ color: '#7f7f7f', margin: '10px 0 0', fontSize: '0.75rem', letterSpacing: '1px' }}>DISTANCE</p>
            <p style={{ fontSize: '1.05rem', fontWeight: 700, color: '#a8c0a0', margin: '2px 0 0' }}>{meta.distance_nm ? `${meta.distance_nm} nm` : '--'}</p>
            <p style={{ color: '#7f7f7f', margin: '10px 0 0', fontSize: '0.75rem', letterSpacing: '1px' }}>POLAR TARGET</p>
            <p style={{ fontSize: '1.05rem', fontWeight: 700, color: '#00ff00', margin: '2px 0 0' }}>{meta.polar_target_kts ? `${meta.polar_target_kts} kts` : '--'}</p>
          </div>

          <div style={{ padding: '18px', background: '#051205', borderRadius: '14px', boxShadow: '0 0 30px rgba(0, 255, 0, 0.18)' }}>
            <p style={{ color: '#7f7f7f', margin: 0, fontSize: '0.85rem', letterSpacing: '1px' }}>SAIL TRIM HUD</p>
            <p style={{ color: '#7bdfff', margin: '8px 0 2px', fontSize: '0.85rem', fontWeight: 700 }}>{getSailMode()}</p>
            <p style={{ color: '#a8c0a0', margin: '2px 0 4px', fontSize: '0.8rem' }}>TWA {meta.twa || '--'}° | TWS {meta.tws || '--'} kt</p>
            <p style={{ fontSize: '1.0rem', fontWeight: 'bold', color: '#00ff00', fontFamily: 'monospace', letterSpacing: '0.5px', margin: '8px 0 0', lineHeight: 1.4 }}>{getSailTrim()}</p>
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
      <div className="map-side" style={{ width: 'calc(100% - 380px)' }}>
        <MapContainer
          center={routeCenter}
          bounds={routeBounds}
          maxBounds={routeBounds}
          maxBoundsViscosity={0.8}
          zoom={6}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution='&copy; OpenStreetMap contributors &copy; CARTO' />
          <MapEvents onSetStart={(pos) => setStartPos(pos)} />
          <Marker position={startPos}><Popup>Current Position</Popup></Marker>
          <Marker position={endPos}><Popup>Finish Point</Popup></Marker>
          <IsochroneFans fans={isochroneFans} startPos={startPos} />
          {routeData && routeData.length > 1 && <Polyline positions={routeData} color="#34d399" weight={4} opacity={0.9} />}
          {noRoute && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 1200,
              padding: '12px 16px',
              background: 'rgba(0,0,0,0.8)',
              color: '#ff7f50',
              borderRadius: '12px',
              border: '1px solid rgba(255,127,80,0.35)',
              fontWeight: 700,
              pointerEvents: 'none',
            }}>
              NO WATER-ONLY ROUTE FOUND
            </div>
          )}
          <WindStreamlineOverlay active={showWindStreamlines} forecastHour={forecastHour} windGrid={windGrid} />
          {showWindStreamlines && windBarbs().map((line, idx) => (
            <Polyline
              key={`wind-barb-${idx}`}
              positions={line.positions}
              pathOptions={{ color: line.color, weight: line.weight, opacity: 0.95 }}
            />
          ))}
          {showCurrentHeatmap && currentField.vectors && currentField.vectors.map((vec, idx) => {
            const endLat = vec.lat + (vec.v * 0.12);
            const endLon = vec.lon + (vec.u * 0.12) / Math.max(Math.cos(vec.lat * Math.PI / 180), 0.18);
            const magnitude = Math.hypot(vec.u, vec.v);
            return (
              <Polyline
                key={`current-vector-${idx}`}
                positions={[[vec.lat, vec.lon], [endLat, endLon]]}
                pathOptions={{ color: magnitude > 0.6 ? '#ffae42' : '#7dd3fc', weight: 2, opacity: 0.9 }}
              />
            );
          })}
          {showCurrentHeatmap && currentHeatmapLayers()}
          <WeatherHeatmapOverlay showCurrent={showCurrentHeatmap} showTemp={showSeaTemp} currentZones={currentZones} seaTempData={seaTempData} forecastHour={forecastHour} />
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
            <div style={{ fontSize: '0.92rem', fontWeight: 700 }}>
              Forecast +{forecastHour}h
              <span style={{ marginLeft: '10px', fontSize: '0.78rem', color: forecastHour >= 72 ? '#ff7f50' : '#93c5fd' }}>
                {forecastHour < 24 ? 'Harbor forecast' : forecastHour < 72 ? 'Race window' : forecastHour < 96 ? 'GS meander zone' : 'Full crossing'}
              </span>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#555' }}>5-day | 120 h</div>
          </div>
          <input
            type="range"
            min="0"
            max="120"
            step="6"
            value={forecastHour}
            onChange={(e) => setForecastHour(Number(e.target.value))}
            style={{ width: '100%', marginTop: '12px', accentColor: forecastHour >= 72 ? '#ff7f50' : '#00ff00' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#94a3b8', marginTop: '6px' }}>
            {forecastHours.map((hour) => (
              <span key={hour} style={{ color: hour >= 72 ? '#ff9966' : '#94a3b8' }}>{hour}h</span>
            ))}
          </div>
        </div>
        <div style={{ position: 'absolute', bottom: '24px', right: '24px', width: '200px', height: '200px', borderRadius: '50%', background: 'rgba(1, 8, 4, 0.92)', border: '1.5px solid rgba(0,255,0,0.30)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 50px rgba(0,255,0,0.22)', zIndex: 999 }}>
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            {/* tick ring */}
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.06)' }} />
            <div style={{ position: 'absolute', inset: '10px', borderRadius: '50%', border: '1px dashed rgba(255,255,255,0.04)' }} />
            {/* cardinal labels */}
            <div style={{ position: 'absolute', top: '8px', left: '50%', transform: 'translateX(-50%)', fontSize: '0.68rem', color: '#888', fontFamily: 'monospace' }}>N</div>
            <div style={{ position: 'absolute', bottom: '8px', left: '50%', transform: 'translateX(-50%)', fontSize: '0.68rem', color: '#888', fontFamily: 'monospace' }}>S</div>
            <div style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.68rem', color: '#888', fontFamily: 'monospace' }}>W</div>
            <div style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.68rem', color: '#888', fontFamily: 'monospace' }}>E</div>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {/* TWD needle – yellow dashed */}
              <div style={{ position: 'absolute', width: '3px', height: '72px', borderLeft: '3px dashed rgba(255,216,80,0.90)', transform: `rotate(${parseWindDirection(meta.twd || meta.wind_dir || 0)}deg) translateY(-22px)`, transformOrigin: 'center bottom' }} />
              {/* OPT needle – blue */}
              <div style={{ position: 'absolute', width: '3px', height: '68px', background: 'rgba(80,140,255,0.95)', borderRadius: '2px', transform: `rotate(${getCompassData().opt}deg) translateY(-20px)`, transformOrigin: 'center bottom', boxShadow: '0 0 14px rgba(80,140,255,0.4)' }} />
              {/* COG needle – neon green */}
              <div style={{ position: 'absolute', width: '4px', height: '82px', background: '#00ff00', borderRadius: '2px', transform: `rotate(${getCompassData().cog}deg) translateY(-24px)`, transformOrigin: 'center bottom', boxShadow: '0 0 18px rgba(0,255,0,0.5)' }} />
              {/* center hub */}
              <div style={{ position: 'absolute', width: '10px', height: '10px', borderRadius: '50%', background: '#001800', border: '2px solid rgba(0,255,0,0.5)' }} />
              {/* data readout */}
              <div style={{ position: 'absolute', bottom: '18px', left: '50%', transform: 'translateX(-50%)', textAlign: 'center', whiteSpace: 'nowrap' }}>
                <div style={{ color: '#00ff00', fontSize: '0.85rem', fontWeight: 700, fontFamily: 'monospace', textShadow: '0 0 8px rgba(0,255,0,0.6)' }}>COG {meta.cog != null ? `${Math.round(meta.cog)}°` : '--'}</div>
                <div style={{ color: '#508cff', fontSize: '0.72rem', fontFamily: 'monospace' }}>OPT {meta.opt_heading != null ? `${Math.round(meta.opt_heading)}°` : '--'}</div>
                <div style={{ color: '#ffd850', fontSize: '0.72rem', fontFamily: 'monospace' }}>TWD {meta.twd != null ? `${Math.round(meta.twd)}°` : '--'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GulfStreamMap;
