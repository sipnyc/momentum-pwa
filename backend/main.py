import os
import math
import requests
import numpy as np
import xarray as xr
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from global_land_mask import globe

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

GRIB_FILE = "latest_wind.grib2"
DEST_LAT = 32.3078
DEST_LON = -64.7505
ENSEMBLE_SPREAD = {
    "GFS": "±1.4 kt",
    "ECMWF": "±0.9 kt",
    "ICON": "±1.7 kt",
}

PHASE_WEIGHTS = {
    "Chesapeake": 1.04,
    "Gulf Stream": 1.03,
    "Approach": 0.98,
}


def download_weather():
    if not os.path.exists(GRIB_FILE):
        print("Downloading latest Atlantic wind GRIB...")
        url = (
            "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?"
            "file=gfs.t00z.pgrb2.0p25.f000&lev_10_m_above_ground=on&var_UGRD=on&var_VGRD=on&"
            "subregion=&leftlon=-80&rightlon=-60&toplat=45&bottomlat=30"
        )
        try:
            response = requests.get(url, timeout=40)
            response.raise_for_status()
            with open(GRIB_FILE, "wb") as fh:
                fh.write(response.content)
            print("Wind GRIB downloaded.")
        except Exception as exc:
            print(f"Failed to download wind GRIB: {exc}")


def load_grib(path):
    return xr.open_dataset(path, engine='cfgrib')


def sample_grid(ds, u_key, v_key, rows=12, cols=18):
    u = ds[u_key].values[0] if ds[u_key].ndim > 2 else ds[u_key].values
    v = ds[v_key].values[0] if ds[v_key].ndim > 2 else ds[v_key].values
    lats = ds['latitude'].values
    lons = ds['longitude'].values
    lat_stride = max(1, len(lats) // rows)
    lon_stride = max(1, len(lons) // cols)
    grid = []
    for i in range(0, len(lats), lat_stride):
        for j in range(0, len(lons), lon_stride):
            grid.append({
                "lat": float(lats[i]),
                "lon": float(lons[j]),
                "u": float(u[i, j]) if i < u.shape[0] and j < u.shape[1] else 0.0,
                "v": float(v[i, j]) if i < v.shape[0] and j < v.shape[1] else 0.0,
            })
    return grid


def extract_wind_field():
    try:
        ds = load_grib(GRIB_FILE)
        vars = list(ds.data_vars)
        u_key = next((k for k in vars if 'ugrd' in k.lower() or 'u10' in k.lower()), None)
        v_key = next((k for k in vars if 'vgrd' in k.lower() or 'v10' in k.lower()), None)
        if u_key and v_key:
            return sample_grid(ds, u_key, v_key)
    except Exception as exc:
        print(f"extract_wind_field failed: {exc}")
    wind_dir = math.radians(240)
    wind_speed = 18.0
    u = -wind_speed * math.sin(wind_dir)
    v = -wind_speed * math.cos(wind_dir)
    return [
        {"lat": 38.9 + dy, "lon": -77.0 + dx, "u": u, "v": v}
        for dy in (-2.0, 0.0, 2.0)
        for dx in (-3.0, 0.0, 3.0)
    ]


def extract_current_field():
    zones = [
        {"bounds": [[33.5, -75.5], [34.2, -73.5]], "intensity": 0.85, "name": "Gulf Stream Core"},
        {"bounds": [[32.7, -72.8], [33.3, -71.2]], "intensity": 0.65, "name": "Meander Zone"},
        {"bounds": [[32.0, -71.0], [33.5, -69.5]], "intensity": 0.45, "name": "Recirculation"},
    ]
    vectors = []
    try:
        ds = load_grib(GRIB_FILE)
        vars = list(ds.data_vars)
        u_key = next((k for k in vars if 'ucur' in k.lower() or 'ugrd' in k.lower()), None)
        v_key = next((k for k in vars if 'vcur' in k.lower() or 'vgrd' in k.lower()), None)
        if u_key and v_key:
            vectors = sample_grid(ds, u_key, v_key, rows=8, cols=8)
    except Exception as exc:
        print(f"extract_current_field failed: {exc}")
    if not vectors:
        vectors = [
            {"lat": 33.8, "lon": -74.8, "u": 0.7, "v": 0.3},
            {"lat": 33.2, "lon": -72.4, "u": 0.4, "v": 0.2},
            {"lat": 32.8, "lon": -70.8, "u": 0.25, "v": 0.05},
        ]
    fastest = max(zones, key=lambda z: z['intensity'])
    return {"zones": zones, "vectors": vectors, "fastest_zone": fastest}


def extract_sea_temp():
    try:
        ds = load_grib(GRIB_FILE)
        temp_key = next((k for k in ds.data_vars if 'tmp' in k.lower() or 'sst' in k.lower()), None)
        if temp_key is not None:
            temp_data = ds[temp_key].values[0] if ds[temp_key].ndim > 2 else ds[temp_key].values
            lats = ds['latitude'].values
            lons = ds['longitude'].values
            temp_min = float(np.nanmin(temp_data))
            temp_max = float(np.nanmax(temp_data))
            isotherms = [
                {"temp": round(v, 1), "bounds": [[33.9, -76.2], [33.6, -74.5], [33.3, -72.8], [33.0, -71.2]]}
                for v in np.linspace(temp_min, temp_max, 5)
            ]
            cold_wall = []
            threshold = 0.8
            if temp_data.ndim >= 2:
                for i in range(temp_data.shape[0] - 1):
                    for j in range(temp_data.shape[1] - 1):
                        dlat = abs(float(temp_data[i + 1, j]) - float(temp_data[i, j]))
                        dlon = abs(float(temp_data[i, j + 1]) - float(temp_data[i, j]))
                        if dlat >= threshold or dlon >= threshold:
                            cold_wall.append({"lat": float(lats[i]), "lon": float(lons[j]), "delta": round(max(dlat, dlon), 2)})
            return {"isotherms": isotherms, "min_temp": temp_min, "max_temp": temp_max, "cold_wall": cold_wall, "cold_wall_threshold": threshold}
    except Exception as exc:
        print(f"extract_sea_temp failed: {exc}")
    return {
        "isotherms": [
            {"temp": 20.5, "bounds": [[33.9, -76.2], [33.6, -74.5], [33.3, -72.8], [33.0, -71.2]]},
            {"temp": 22.1, "bounds": [[33.8, -76.0], [33.5, -74.3], [33.2, -72.6], [32.9, -71.0]]},
        ],
        "min_temp": 20.0,
        "max_temp": 25.0,
        "cold_wall": [],
        "cold_wall_threshold": 0.8,
    }


def normalize_angle(angle):
    return angle % 360


def angular_difference(a, b):
    return abs((a - b + 180) % 360 - 180)


def bearing(lat1, lon1, lat2, lon2):
    dlon = math.radians(lon2 - lon1)
    lat1r = math.radians(lat1)
    lat2r = math.radians(lat2)
    y = math.sin(dlon) * math.cos(lat2r)
    x = math.cos(lat1r) * math.sin(lat2r) - math.sin(lat1r) * math.cos(lat2r) * math.cos(dlon)
    return normalize_angle(math.degrees(math.atan2(y, x)))


def haversine_nm(lat1, lon1, lat2, lon2):
    r_nm = 3440.065
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r_nm * c


def interpolate_polar_value(twa):
    polar_knots = {
        0: 0.1,
        30: 7.2,
        45: 7.2,
        60: 8.4,
        75: 9.1,
        90: 9.3,
        110: 9.5,
        120: 9.4,
        135: 8.9,
        150: 8.5,
        165: 7.6,
        180: 7.0,
    }
    keys = sorted(polar_knots)
    if twa <= keys[0]:
        return polar_knots[keys[0]]
    if twa >= keys[-1]:
        return polar_knots[keys[-1]]
    for i in range(len(keys) - 1):
        a, b = keys[i], keys[i + 1]
        if a <= twa <= b:
            return polar_knots[a] + (polar_knots[b] - polar_knots[a]) * ((twa - a) / (b - a))
    return polar_knots[keys[-1]]


def polar_speed(twa, tws):
    base = interpolate_polar_value(twa)
    if tws <= 5:
        factor = 0.55 + 0.45 * (tws / 5)
    else:
        factor = min(1.0, tws / 15)
    return max(0.1, base * factor)


def nearest_vector(field, lat_pt, lon_pt):
    if not field:
        return None
    return min(field, key=lambda item: (item.get("lat", 0.0) - lat_pt) ** 2 + (item.get("lon", 0.0) - lon_pt) ** 2)


def wind_at(lat_pt, lon_pt, wind_field):
    best = nearest_vector(wind_field, lat_pt, lon_pt)
    if not best:
        return 240.0, 15.0, 15.0
    u = best.get("u", 0.0)
    v = best.get("v", 0.0)
    speed = math.hypot(u, v)
    heading = normalize_angle(math.degrees(math.atan2(-u, -v)))
    return heading, max(1.0, speed), speed


def current_at(lat_pt, lon_pt, vectors):
    best = nearest_vector(vectors, lat_pt, lon_pt)
    if not best:
        return 0.0, 0.0
    return best.get("u", 0.0), best.get("v", 0.0)


def point_on_land(lat_pt, lon_pt):
    try:
        return globe.is_land(lat_pt, lon_pt)
    except Exception:
        return False


def compute_phase(lat_pt, lon_pt):
    if lat_pt >= 36.0 and -79.0 <= lon_pt <= -72.0:
        return "Chesapeake"
    if lat_pt <= 34.5 and -77.5 <= lon_pt <= -69.0:
        return "Gulf Stream"
    return "Approach"


def vmc_candidate_score(dest_bearing, heading, current_u, current_v, wind_dir, tws, phase):
    twa = angular_difference(wind_dir, heading)
    boat_speed = polar_speed(twa, tws)
    boat_x = math.sin(math.radians(heading)) * boat_speed
    boat_y = math.cos(math.radians(heading)) * boat_speed
    combined_x = boat_x + current_u
    combined_y = boat_y + current_v
    dest_x = math.sin(math.radians(dest_bearing))
    dest_y = math.cos(math.radians(dest_bearing))
    score = combined_x * dest_x + combined_y * dest_y
    if phase == "Gulf Stream":
        score += 0.8
    return score, twa, boat_speed


def find_vmc_heading(dest_bearing, current_u, current_v, wind_dir, tws, phase):
    best = {"heading": dest_bearing, "score": -999.0, "twa": 0.0, "speed": 0.0}
    for offset in range(-90, 91, 3):
        heading = normalize_angle(dest_bearing + offset)
        score, twa, speed = vmc_candidate_score(dest_bearing, heading, current_u, current_v, wind_dir, tws, phase)
        if score > best["score"]:
            best = {"heading": heading, "score": score, "twa": twa, "speed": speed}
    return best


def project_point(lat, lon, heading, speed_knots, hours):
    nm = speed_knots * hours
    lat_rad = math.radians(lat)
    delta_lat = nm * math.cos(math.radians(heading)) / 60.0
    delta_lon = nm * math.sin(math.radians(heading)) / (60.0 * max(math.cos(lat_rad), 0.15))
    return lat + delta_lat, lon + delta_lon


def plan_isochrone(start_lat, start_lon, end_lat, end_lon, wind_field, current_field, forecast_hour):
    points = [[round(start_lat, 6), round(start_lon, 6)]]
    lat_pt, lon_pt = start_lat, start_lon
    total_nm = 0.0
    total_hours = 0
    last_heading = heading = bearing(start_lat, start_lon, end_lat, end_lon)
    biases = []

    while total_hours < 24:
        distance = haversine_nm(lat_pt, lon_pt, end_lat, end_lon)
        if distance <= 10:
            break
        wind_dir, tws, wind_speed = wind_at(lat_pt, lon_pt, wind_field)
        current_u, current_v = current_at(lat_pt, lon_pt, current_field.get("vectors", []))
        phase = compute_phase(lat_pt, lon_pt)
        target_bearing = bearing(lat_pt, lon_pt, end_lat, end_lon)
        best = find_vmc_heading(target_bearing, current_u, current_v, wind_dir, tws, phase)
        speed = max(0.4, best["speed"] * PHASE_WEIGHTS.get(phase, 1.0))
        next_lat, next_lon = project_point(lat_pt, lon_pt, best["heading"], speed, 3.0)
        if point_on_land(next_lat, next_lon):
            safe = False
            for offset in (15, -15, 30, -30, 45, -45):
                alt_heading = normalize_angle(best["heading"] + offset)
                alt_lat, alt_lon = project_point(lat_pt, lon_pt, alt_heading, speed, 3.0)
                if not point_on_land(alt_lat, alt_lon):
                    next_lat, next_lon = alt_lat, alt_lon
                    safe = True
                    break
            if not safe:
                break
        points.append([round(next_lat, 6), round(next_lon, 6)])
        total_nm += speed * 3.0
        total_hours += 3
        biases.append(abs(speed - wind_speed) / max(1.0, wind_speed))
        lat_pt, lon_pt = next_lat, next_lon
        last_heading = best["heading"]
        if haversine_nm(lat_pt, lon_pt, end_lat, end_lon) <= 10:
            break
    remaining = haversine_nm(lat_pt, lon_pt, end_lat, end_lon)
    remainder_hours = min(6, int(math.ceil(remaining / max(0.1, 8.0))))
    return {
        "points": points,
        "duration_h": total_hours + remainder_hours,
        "distance_nm": round(total_nm, 1),
        "heading": last_heading,
        "bias_scalar": round(1.0 + (sum(biases) / max(1, len(biases))) * 0.06, 3),
        "phase": compute_phase(lat_pt, lon_pt),
    }


def compute_bias(forecast_speed, actual_speed):
    if forecast_speed < 1.0:
        return 1.0
    return round(max(0.92, min(1.08, 1.0 + (actual_speed - forecast_speed) / forecast_speed * 0.1)), 3)


@app.post("/isochrone")
async def calculate_route(data: dict):
    start_lat = data.get("start_lat") or data.get("lat") or 38.9784
    start_lon = data.get("start_lon") or data.get("lon") or -76.4922
    end_lat = data.get("end_lat", DEST_LAT)
    end_lon = data.get("end_lon", DEST_LON)
    forecast_hour = data.get("forecast_hour", 0)
    active_model = data.get("model", "GFS")

    download_weather()
    wind_field = extract_wind_field()
    current_field = extract_current_field()
    sea_temp = extract_sea_temp()

    route = plan_isochrone(start_lat, start_lon, end_lat, end_lon, wind_field, current_field, forecast_hour)
    wind_dir, tws, wind_speed = wind_at(start_lat, start_lon, wind_field)
    current_u, current_v = current_at(start_lat, start_lon, current_field.get("vectors", []))
    current_speed = round(math.hypot(current_u, current_v), 2)
    vmg = round(max(0.0, math.cos(math.radians(angular_difference(wind_dir, route["heading"]))) * polar_speed(angular_difference(wind_dir, route["heading"]), tws)), 2)
    bias_scalar = compute_bias(wind_speed, wind_speed * 0.97)
    certainty = 100 - int(float(ENSEMBLE_SPREAD.get(active_model, "±1.4 kt").strip('± kt')) * 4)
    return {
        "points": route["points"],
        "metadata": {
            "status": f"{route['phase']} phase",
            "model": active_model,
            "ensemble_spread": ENSEMBLE_SPREAD.get(active_model, "±1.4 kt"),
            "certainty": f"{certainty}%",
            "bias_scalar": bias_scalar,
            "wind_dir": round(wind_dir, 0),
            "wind_speed": round(wind_speed, 1),
            "tws": round(tws, 1),
            "twa": round(angular_difference(wind_dir, route["heading"]), 0),
            "cog": round(route["heading"], 0),
            "opt_heading": round(route["heading"], 0),
            "vmc_heading": round(route["heading"], 0),
            "vmg": vmg,
            "current_velocity": current_speed,
            "current_compensation": current_speed >= 0.8 and "Current profit engaged" or "Neutral drift",
            "eta_adjusted_h": route["duration_h"],
            "time_to_finish_h": route["duration_h"],
            "fastest_current_area": current_field.get("fastest_zone"),
            "wind_field": wind_field,
            "current_field": current_field,
            "sea_temp": sea_temp,
            "cold_wall_count": len(sea_temp.get("cold_wall", [])),
        },
    }
