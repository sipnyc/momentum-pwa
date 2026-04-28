import csv
import math
import os

import numpy as np
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from scipy.interpolate import RegularGridInterpolator

app = FastAPI()
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

BERMUDA = (32.3078, -64.7505)
_POLAR_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "HR53-Boatspeed.csv")


# ── HR53 Polar interpolator ────────────────────────────────────────

def _load_polars():
    twa_vals, tws_vals, matrix = [], [], []
    with open(_POLAR_CSV) as f:
        reader = csv.reader(f)
        header = next(reader)
        tws_vals = [float(x) for x in header[1:]]
        for row in reader:
            twa_vals.append(float(row[0]))
            matrix.append([float(x) for x in row[1:]])
    interp = RegularGridInterpolator(
        (np.array(twa_vals), np.array(tws_vals)),
        np.array(matrix),
        method="linear",
        bounds_error=False,
        fill_value=None,
    )
    return interp, np.array(twa_vals), np.array(tws_vals)


_POLAR_INTERP, _POLAR_TWA, _POLAR_TWS = _load_polars()


def polar_speed(twa_deg: float, tws_kts: float, bias: float = 1.0) -> float:
    """Interpolated HR53 boat speed (knots) for given TWA and TWS."""
    twa = float(np.clip(abs(twa_deg), float(_POLAR_TWA[0]), float(_POLAR_TWA[-1])))
    tws = float(np.clip(tws_kts, float(_POLAR_TWS[0]), float(_POLAR_TWS[-1])))
    return float(_POLAR_INTERP([[twa, tws]])[0]) * bias


def best_polar_speed(tws_kts: float, bias: float = 1.0) -> tuple:
    """Return (best_twa, best_speed) for given TWS – the polar sweet spot."""
    tws = float(np.clip(tws_kts, float(_POLAR_TWS[0]), float(_POLAR_TWS[-1])))
    best_twa, best_bs = 90.0, 0.0
    for twa in _POLAR_TWA:
        bs = polar_speed(float(twa), tws, bias)
        if bs > best_bs:
            best_bs, best_twa = bs, float(twa)
    return best_twa, round(best_bs, 2)


# ── Geometry ───────────────────────────────────────────────────────

def haversine_nm(lat1, lon1, lat2, lon2) -> float:
    R = 3440.065
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.asin(math.sqrt(max(0.0, min(1.0, a))))


def bearing(lat1, lon1, lat2, lon2) -> float:
    dlam = math.radians(lon2 - lon1)
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    y = math.sin(dlam) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlam)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def propagate(lat, lon, hdg_deg, speed_kts, cu=0.0, cv=0.0, dt_h=1 / 3) -> tuple:
    """Advance a point for dt_h hours along hdg at speed + current (cu east, cv north)."""
    NM = 60.0
    rad = math.radians(hdg_deg)
    vx = speed_kts * math.sin(rad) + cu
    vy = speed_kts * math.cos(rad) + cv
    mid_lat = lat + (vy * dt_h) / (2.0 * NM)
    dlat = (vy * dt_h) / NM
    dlon = (vx * dt_h) / (NM * math.cos(math.radians(mid_lat)))
    return lat + dlat, lon + dlon


# ── Atlantic routing corridor ──────────────────────────────────────

def in_ocean(lat, lon) -> bool:
    if not (27.0 <= lat <= 43.0 and -79.0 <= lon <= -60.0):
        return False
    if lat < 30.5 and lon > -81.0:   # Florida
        return False
    if 34.5 <= lat <= 35.3 and lon > -75.8:   # Cape Hatteras shoals
        return False
    return True


# ── Synthetic wind model ───────────────────────────────────────────

def wind_at(lat, lon, forecast_hour: float = 0) -> tuple:
    """Time-varying synthetic Atlantic wind: SW base, system builds over 120 h.

    At t=0:  ~10-13 kt, 220-230°.
    At t=72: front approaches, veers W, builds to 16-20 kt.
    At t=120: post-front NW, 18-22 kt (classic A2B weather window).
    """
    t = forecast_hour / 120.0  # 0→1 over the full race window
    # Direction veers from SW (225°) toward W/NW (285°) as front passes ~t=0.55
    veer = 60.0 * math.exp(-((t - 0.55) ** 2) / 0.06)  # bell-shaped veer at t=55%
    base_dir = 225.0 + veer + 18.0 * math.sin(math.radians(lat * 4 + lon * 2))
    # Speed: builds to peak ~t=0.6 then settles
    build = 1.0 + 0.7 * math.exp(-((t - 0.60) ** 2) / 0.08)
    base_spd = (13.0 + 4.0 * math.sin(math.radians(lat * 5)) + 2.5 * math.cos(math.radians(lon * 3))) * build
    return base_dir % 360, max(4.0, base_spd)


# ── Gulf Stream current model ──────────────────────────────────────

def current_at(lat, lon) -> tuple:
    """Simplified RTOFS Gulf Stream: core flows NE at up to 2 kt; cold eddies southward."""
    gs_lat = 37.0 - (lon + 73.0) * 0.28   # GS axis approximation
    dist = lat - gs_lat
    if abs(dist) <= 1.5:
        strength = 2.0 * math.exp(-0.5 * (dist / 0.7) ** 2)
        cu = strength * math.sin(math.radians(45))
        cv = strength * math.cos(math.radians(45))
        return cu, cv
    if -3.0 <= dist < 0:
        eddy = 0.55 * math.exp((dist + 1.5) / 1.5)
        cu = -eddy * math.sin(math.radians((lon * 15) % 360))
        cv = -eddy * math.cos(math.radians((lat * 15) % 360))
        return cu, cv
    return 0.0, 0.0


def gs_profit_kts(lat, lon) -> float:
    cu, cv = current_at(lat, lon)
    return round(math.hypot(cu, cv), 2)


# ── Isochrone fan expansion ────────────────────────────────────────
# Fans are visual-only "reachability bubbles" at 3 h, 6 h, 12 h.
# We expand with 3-hour steps so each capture is exactly one step.

_FAN_DT = 3.0          # hours per fan step
_N_FAN_HDG = 24        # headings tested (every 15°)
_FAN_STEPS = [1, 2, 4] # steps → 3 h, 6 h, 12 h


def _prune_frontier(lats, lons):
    """Keep the most-advanced (min distance-to-dest is not relevant here;
    we just deduplicate by 0.5° geographic cell, keeping farthest spread)."""
    seen = set()
    out_lat, out_lon = [], []
    for la, lo in zip(lats, lons):
        cell = (round(la * 2) / 2, round(lo * 2) / 2)
        if cell not in seen:
            seen.add(cell)
            out_lat.append(la)
            out_lon.append(lo)
    return out_lat, out_lon


def expand_fans(start_lat, start_lon, end_lat, end_lon, bias) -> list:
    """3-step fan expansion capturing reachability rings at 3 h, 6 h, 12 h."""
    f_lat = [start_lat]
    f_lon = [start_lon]
    fans = []
    max_step = max(_FAN_STEPS)

    for step in range(1, max_step + 1):
        new_lat, new_lon = [], []
        for la, lo in zip(f_lat, f_lon):
            twd, tws = wind_at(la, lo)
            cu, cv = current_at(la, lo)
            for i in range(_N_FAN_HDG):
                hdg = i * (360.0 / _N_FAN_HDG)
                twa = (hdg - twd + 360) % 360
                if twa > 180:
                    twa = 360 - twa
                bs = polar_speed(twa, tws, bias)
                if bs < 0.5:
                    continue
                nla, nlo = propagate(la, lo, hdg, bs, cu, cv, _FAN_DT)
                if not in_ocean(nla, nlo):
                    continue
                new_lat.append(nla)
                new_lon.append(nlo)

        if not new_lat:
            break
        # Capture ring at this step if it is a fan-capture step
        if step in _FAN_STEPS:
            fans.append([[float(la), float(lo)] for la, lo in zip(new_lat, new_lon)])
        f_lat, f_lon = _prune_frontier(new_lat, new_lon)

    return fans


def eta_from_path(path: list, bias: float) -> float:
    """Estimate ETA by integrating polar speed along the greedy path."""
    total_h = 0.0
    for i in range(len(path) - 1):
        la1, lo1 = path[i][0], path[i][1]
        la2, lo2 = path[i + 1][0], path[i + 1][1]
        d = haversine_nm(la1, lo1, la2, lo2)
        twd, tws = wind_at((la1 + la2) / 2, (lo1 + lo2) / 2)
        brg = bearing(la1, lo1, la2, lo2)
        twa = (brg - twd + 360) % 360
        if twa > 180:
            twa = 360 - twa
        bs = max(0.5, polar_speed(twa, tws, bias))
        total_h += d / bs
    return round(total_h, 1)


# ── Greedy VMC path builder ────────────────────────────────────────

_PATH_DT = 1 / 3       # 20-minute steps
_PATH_HDG = 36         # headings tested per step
_PATH_MAX_PTS = 45


def build_path(start_lat, start_lon, end_lat, end_lon, bias) -> list:
    """Greedy maximum-VMC path for route display."""
    path = [[start_lat, start_lon]]
    la, lo = start_lat, start_lon
    max_steps = int(120 / _PATH_DT)
    emit_every = max(1, max_steps // _PATH_MAX_PTS)

    for step in range(max_steps):
        dist = haversine_nm(la, lo, end_lat, end_lon)
        if dist < 8.0:
            path.append([end_lat, end_lon])
            break
        twd, tws = wind_at(la, lo)
        cu, cv = current_at(la, lo)
        best_vmc, best_la, best_lo = -1e9, la, lo
        for i in range(_PATH_HDG):
            hdg = i * (360.0 / _PATH_HDG)
            twa = (hdg - twd + 360) % 360
            if twa > 180:
                twa = 360 - twa
            bs = polar_speed(twa, tws, bias)
            if bs < 0.3:
                continue
            nla, nlo = propagate(la, lo, hdg, bs, cu, cv, _PATH_DT)
            if not in_ocean(nla, nlo):
                continue
            ndist = haversine_nm(nla, nlo, end_lat, end_lon)
            vmc = (dist - ndist) / _PATH_DT
            if vmc > best_vmc:
                best_vmc, best_la, best_lo = vmc, nla, nlo
        la, lo = best_la, best_lo
        if step % emit_every == 0:
            path.append([la, lo])

    if not path or path[-1] != [end_lat, end_lon]:
        path.append([end_lat, end_lon])
    return path


# ── Sail trim advisor ──────────────────────────────────────────────

def sail_trim(twa: float, tws: float) -> dict:
    """Return sail mode and configuration for given TWA/TWS."""
    if twa < 45:
        mode, sails = "Close Hauled", "Main + 100% Jib (pinned hard)"
    elif twa < 75:
        mode, sails = "Close Reach", "Main + 130% Genoa (leads aft 1 notch)"
    elif twa < 100:
        mode, sails = "Beam Reach", "Main + 150% Genoa (sheet eased)"
    elif twa < 135:
        if tws >= 10:
            mode, sails = "Broad Reach", "Main + A2 Spinnaker (optimal angle)"
        else:
            mode, sails = "Broad Reach", "Main + 150% Genoa (ease 2 notches)"
    elif twa < 160:
        if tws >= 8:
            mode, sails = "Deep Broad Reach", "Main + A3 Runner Spinnaker"
        else:
            mode, sails = "Deep Broad Reach", "Main + Poled-out 150% Genoa"
    else:
        if tws >= 8:
            mode, sails = "Running", "Main + A3 Spinnaker (pole to weather)"
        else:
            mode, sails = "Running", "Main + Poled-out Genoa (wing-on-wing)"
    return {"mode": mode, "sails": sails, "twa": round(twa, 0), "tws": round(tws, 1)}


# ── Wind/current field for heatmap ────────────────────────────────

def build_wind_field(forecast_hour: float = 0, bounds=((33.0, -79.0), (40.0, -64.0)), rows=10, cols=15):
    points = []
    lat0, lon0 = bounds[0]
    lat1, lon1 = bounds[1]
    for r in range(rows):
        la = lat0 + (lat1 - lat0) * r / (rows - 1)
        for c in range(cols):
            lo = lon0 + (lon1 - lon0) * c / (cols - 1)
            twd, tws = wind_at(la, lo, forecast_hour)
            rad = math.radians((twd + 180) % 360)
            u = tws * math.sin(rad)
            v = tws * math.cos(rad)
            points.append({"lat": round(la, 3), "lon": round(lo, 3), "u": round(u, 2), "v": round(v, 2)})
    return points


def build_current_zones():
    """Return Gulf Stream + eddy zones for frontend heatmap."""
    zones = []
    # Gulf Stream core band: lon-driven path
    for lo in range(-77, -65, 3):
        gs_lat = 37.0 - (lo + 73.0) * 0.28
        bounds = [
            [gs_lat - 0.8, lo], [gs_lat - 0.8, lo + 3],
            [gs_lat + 0.8, lo + 3], [gs_lat + 0.8, lo],
        ]
        cu, cv = current_at(gs_lat, lo + 1.5)
        intensity = math.hypot(cu, cv) / 2.0
        zones.append({"bounds": bounds, "intensity": round(min(1.0, intensity), 2), "type": "gs_core"})
    # Cold eddy south of GS
    for lo in range(-75, -67, 4):
        gs_lat = 37.0 - (lo + 73.0) * 0.28
        eddy_lat = gs_lat - 2.0
        bounds = [
            [eddy_lat - 1.0, lo], [eddy_lat - 1.0, lo + 4],
            [eddy_lat + 1.0, lo + 4], [eddy_lat + 1.0, lo],
        ]
        zones.append({"bounds": bounds, "intensity": 0.18, "type": "cold_eddy"})
    return zones


# ── API ────────────────────────────────────────────────────────────

class RouteRequest(BaseModel):
    start_lat: float
    start_lon: float
    end_lat: float = BERMUDA[0]
    end_lon: float = BERMUDA[1]
    bias: float = 1.0
    forecast_hour: int = 0


@app.post("/isochrone")
async def isochrone_route(req: RouteRequest):
    fans = expand_fans(req.start_lat, req.start_lon, req.end_lat, req.end_lon, req.bias)
    path = build_path(req.start_lat, req.start_lon, req.end_lat, req.end_lon, req.bias)
    eta_h = eta_from_path(path, req.bias)

    dist = haversine_nm(req.start_lat, req.start_lon, req.end_lat, req.end_lon)
    brg = bearing(req.start_lat, req.start_lon, req.end_lat, req.end_lon)
    twd, tws = wind_at(req.start_lat, req.start_lon, req.forecast_hour)
    twa = (brg - twd + 360) % 360
    if twa > 180:
        twa = 360 - twa

    cu, cv = current_at(req.start_lat, req.start_lon)
    gs_kts = round(math.hypot(cu, cv), 1)
    trim = sail_trim(twa, tws)
    bs_polar = polar_speed(twa, tws)
    _, sweet_bs = best_polar_speed(tws)

    eta_display = round(eta_h, 1) if eta_h < float("inf") else round(dist / 8.0, 1)
    bias_pct = round(req.bias * 100)

    wind_field = build_wind_field(req.forecast_hour)
    current_zones = build_current_zones()

    return {
        "points": path,
        "isochrone_fans": fans,
        "metadata": {
            "cog": round(brg, 1),
            "bearing": round(brg, 1),
            "opt_heading": round(brg, 1),
            "twd": round(twd, 0),
            "tws": round(tws, 1),
            "twa": round(twa, 0),
            "status": f"ETA {eta_display}h | {round(dist)}nm | Bias {bias_pct}%",
            "eta_adjusted_h": eta_display,
            "distance_nm": round(dist, 1),
            "gs_current_kts": gs_kts,
            "polar_target_kts": round(bs_polar, 1),
            "polar_sweet_kts": sweet_bs,
            "sail_trim": trim,
            "bias": req.bias,
            "wind_field": wind_field,
            "current_field": {"vectors": [], "zones": current_zones},
        },
    }


@app.get("/health")
def health():
    return {"status": "ok", "polar_tws_range": [float(_POLAR_TWS[0]), float(_POLAR_TWS[-1])]}


if __name__ == "__main__":
    print("Momentum Tactical Engine starting...")
    uvicorn.run(app, host="0.0.0.0", port=8000)
