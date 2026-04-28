import xarray as xr
import os
import math
import requests
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from global_land_mask import globe

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

GRIB_FILE = "latest_wind.grib2"
CURRENT_FILE = "latest_current.grib2"
HR53_POLAR_TABLE = {
    30: 0.38, 45: 0.50, 60: 0.62, 75: 0.74,
    90: 0.84, 105: 0.92, 120: 1.00, 135: 0.96,
    150: 0.90, 165: 0.82, 180: 0.70,
}

def download_weather():
    # Simple GFS fetcher - downloads a small slice of the Atlantic
    if not os.path.exists(GRIB_FILE):
        print("Downloading latest GFS Wind Data...")
        url = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?file=gfs.t00z.pgrb2.0p25.f000&lev_10_m_above_ground=on&var_UGRD=on&var_VGRD=on&subregion=&leftlon=-80&rightlon=-60&toplat=45&bottomlat=30"
        r = requests.get(url)
        with open(GRIB_FILE, "wb") as f:
            f.write(r.content)
        print("Weather Downloaded.")

def extract_wind_field():
    """Extract U/V wind components from GRIB file and return grid of wind vectors"""
    try:
        ds = xr.open_dataset(GRIB_FILE, engine='cfgrib')
        if 'u10m' in ds or 'UGRD_10m' in ds:
            u_key = 'u10m' if 'u10m' in ds else 'UGRD_10m'
            v_key = 'v10m' if 'v10m' in ds else 'VGRD_10m'
            u = ds[u_key].values[0] if u_key in ds else np.zeros((73, 81))
            v = ds[v_key].values[0] if v_key in ds else np.zeros((73, 81))
            lats = ds['latitude'].values
            lons = ds['longitude'].values
            
            # Create 5x5 grid sampling of wind field
            grid = []
            lat_stride = max(1, len(lats) // 5)
            lon_stride = max(1, len(lons) // 5)
            
            for i in range(0, len(lats), lat_stride)[:5]:
                for j in range(0, len(lons), lon_stride)[:5]:
                    lat = float(lats[i])
                    lon = float(lons[j])
                    u_val = float(u[i, j]) if i < len(u) and j < len(u[0]) else 0
                    v_val = float(v[i, j]) if i < len(v) and j < len(v[0]) else 0
                    grid.append({"lat": lat, "lon": lon, "u": u_val, "v": v_val})
            return grid
        else:
            # Fallback: return hardcoded grid if GRIB vars not found
            wind_dir_rad = math.radians(240)
            wind_speed = 18.5
            u = -wind_speed * math.sin(wind_dir_rad)
            v = -wind_speed * math.cos(wind_dir_rad)
            grid = []
            for latOff in [-2, 0, 2]:
                for lonOff in [-3, 0, 3]:
                    grid.append({"lat": 38.9 + latOff, "lon": -77.0 + lonOff, "u": u, "v": v})
            return grid
    except Exception as e:
        print(f"Wind field extraction failed: {e}")
        wind_dir_rad = math.radians(240)
        wind_speed = 18.5
        u = -wind_speed * math.sin(wind_dir_rad)
        v = -wind_speed * math.cos(wind_dir_rad)
        grid = []
        for latOff in [-2, 0, 2]:
            for lonOff in [-3, 0, 3]:
                grid.append({"lat": 38.9 + latOff, "lon": -77.0 + lonOff, "u": u, "v": v})
        return grid

def extract_current_field():
    """Extract ocean current data (approximated as Gulf Stream visualization zones)"""
    current_zones = [
        {"bounds": [[33.5, -75.5], [34.2, -73.5]], "intensity": 0.85, "name": "Gulf Stream Core"},
        {"bounds": [[32.7, -72.8], [33.3, -71.2]], "bounds_secondary": [[32.4, -74.5], [33.1, -72.0]], "intensity": 0.65, "name": "Meander Zone"},
        {"bounds": [[32.0, -71.0], [33.5, -69.5]], "intensity": 0.45, "name": "Recirculation"},
    ]

    try:
        ds = xr.open_dataset(GRIB_FILE, engine='cfgrib')
        available_vars = list(ds.data_vars)
        u_key = next((v for v in available_vars if 'ugrd' in v.lower() or 'ucur' in v.lower()), None)
        v_key = next((v for v in available_vars if 'vgrd' in v.lower() or 'vcur' in v.lower()), None)
        vectors = []

        if u_key and v_key:
            u = ds[u_key].values[0] if ds[u_key].ndim > 2 else ds[u_key].values
            v = ds[v_key].values[0] if ds[v_key].ndim > 2 else ds[v_key].values
            lats = ds['latitude'].values
            lons = ds['longitude'].values
            lat_stride = max(1, len(lats) // 7)
            lon_stride = max(1, len(lons) // 7)
            for i in range(0, len(lats), lat_stride):
                for j in range(0, len(lons), lon_stride):
                    vectors.append({
                        "lat": float(lats[i]),
                        "lon": float(lons[j]),
                        "u": float(u[i, j]) if i < u.shape[0] and j < u.shape[1] else 0.0,
                        "v": float(v[i, j]) if i < v.shape[0] and j < v.shape[1] else 0.0,
                    })
            max_zone = max(current_zones, key=lambda z: z.get("intensity", 0.0))
            return {"zones": current_zones, "has_vector_data": True, "vectors": vectors, "fastest_zone": max_zone}

        max_zone = max(current_zones, key=lambda z: z.get("intensity", 0.0))
        return {"zones": current_zones, "has_vector_data": False, "vectors": [], "fastest_zone": max_zone}
    except Exception as e:
        print(f"Current field extraction failed: {e}")
        max_zone = max(current_zones, key=lambda z: z.get("intensity", 0.0))
        return {
            "zones": [
                {"bounds": [[33.5, -75.5], [34.2, -73.5]], "intensity": 0.85, "name": "Gulf Stream Core"},
                {"bounds": [[32.7, -72.8], [33.3, -71.2]], "intensity": 0.65, "name": "Meander Zone"},
            ],
            "has_vector_data": False,
            "vectors": [],
            "fastest_zone": max_zone
        }

def extract_sea_temp():
    """Extract sea surface temperature from GRIB file"""
    try:
        ds = xr.open_dataset(GRIB_FILE, engine='cfgrib')
        available_vars = list(ds.data_vars)
        temp_var = next((v for v in available_vars if 'tmp' in v.lower() or 'temp' in v.lower()), None)
        
        if temp_var:
            temp_data = ds[temp_var].values[0] if ds[temp_var].ndim > 2 else ds[temp_var].values
            lats = ds['latitude'].values
            lons = ds['longitude'].values
            temp_min = float(np.nanmin(temp_data))
            temp_max = float(np.nanmax(temp_data))

            isotherms = []
            for threshold in np.linspace(temp_min, temp_max, 5):
                isotherms.append({"temp": round(threshold, 1), "bounds": [[33.9, -76.2], [33.6, -74.5], [33.3, -72.8], [33.0, -71.2]]})

            cold_wall = []
            gradient_threshold = 0.8
            if temp_data.ndim >= 2:
                for i in range(temp_data.shape[0] - 1):
                    for j in range(temp_data.shape[1] - 1):
                        dlat = abs(float(temp_data[i + 1, j]) - float(temp_data[i, j]))
                        dlon = abs(float(temp_data[i, j + 1]) - float(temp_data[i, j]))
                        if dlat >= gradient_threshold or dlon >= gradient_threshold:
                            cold_wall.append({
                                "lat": float(lats[i]),
                                "lon": float(lons[j]),
                                "delta": round(max(dlat, dlon), 2)
                            })

            return {
                "isotherms": isotherms,
                "min_temp": temp_min,
                "max_temp": temp_max,
                "cold_wall": cold_wall,
                "cold_wall_threshold": gradient_threshold,
            }
        else:
            # Fallback isotherms
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
    except Exception as e:
        print(f"Sea temp extraction failed: {e}")
        return {
            "isotherms": [
                {"temp": 20.5, "bounds": [[33.9, -76.2], [33.6, -74.5], [33.3, -72.8], [33.0, -71.2]]},
            ],
            "min_temp": 20.0,
            "max_temp": 25.0,
            "cold_wall": [],
            "cold_wall_threshold": 0.8,
        }

@app.post("/isochrone")
async def calculate_route(data: dict):
    lat, lon = data.get("lat"), data.get("lon")
    forecast_hour = data.get("forecast_hour", 0)
    download_weather()
    wind_field = extract_wind_field()
    current_field = extract_current_field()
    sea_temp = extract_sea_temp()

    def heading_between(lat1, lon1, lat2, lon2):
        dlon = math.radians(lon2 - lon1)
        lat1r = math.radians(lat1)
        lat2r = math.radians(lat2)
        y = math.sin(dlon) * math.cos(lat2r)
        x = math.cos(lat1r) * math.sin(lat2r) - math.sin(lat1r) * math.cos(lat2r) * math.cos(dlon)
        heading = math.degrees(math.atan2(y, x))
        return (heading + 360) % 360

    def angular_difference(a, b):
        diff = abs((a - b + 180) % 360 - 180)
        return diff

    def polar_factor(twa):
        targets = {
            30: 0.38, 45: 0.50, 60: 0.62, 75: 0.74,
            90: 0.84, 105: 0.92, 120: 1.00, 135: 0.96,
            150: 0.90, 165: 0.82, 180: 0.70,
        }
        keys = sorted(targets)
        if twa <= keys[0]:
            return targets[keys[0]]
        if twa >= keys[-1]:
            return targets[keys[-1]]
        for i in range(len(keys) - 1):
            a, b = keys[i], keys[i + 1]
            if a <= twa <= b:
                fa, fb = targets[a], targets[b]
                return fa + (fb - fa) * ((twa - a) / (b - a))
        return 0.7

    def polar_speed(twa, tws):
        return max(0.1, tws * polar_factor(twa))

    def nearest_current_vector(lat_pt, lon_pt):
        if not current_field.get("has_vector_data") or not current_field.get("vectors"):
            return 0.0, 0.0
        best = min(
            current_field["vectors"],
            key=lambda item: (item.get("lat", 0.0) - lat_pt) ** 2 + (item.get("lon", 0.0) - lon_pt) ** 2
        )
        return best.get("u", 0.0), best.get("v", 0.0)

    def find_vmc_heading(destination_heading, current_u=0.0, current_v=0.0):
        dest_rad = math.radians(destination_heading)
        dest_unit_x = math.sin(dest_rad)
        dest_unit_y = math.cos(dest_rad)
        best = {"heading": destination_heading, "score": -999.0, "speed": 0.0, "twa": 0.0}
        for offset in range(-75, 76, 5):
            heading = (destination_heading + offset) % 360
            twa = angular_difference(wind_dir, heading)
            speed = polar_speed(twa, tws)
            rad = math.radians(heading)
            boat_x = math.sin(rad) * speed
            boat_y = math.cos(rad) * speed
            ground_x = boat_x + current_u
            ground_y = boat_y + current_v
            score = ground_x * dest_unit_x + ground_y * dest_unit_y
            if score > best["score"]:
                best = {"heading": heading, "score": score, "speed": speed, "twa": twa, "ground_speed": score}
        return best

    def predicted_wind_dir(base_dir, hour_offset):
        return (base_dir + (hour_offset / 24.0) * 40.0) % 360

    def next_maneuver_forecast(current_heading, current_wind):
        forecast_hours = [3, 6, 9, 12]
        for hours in forecast_hours:
            future_wind = predicted_wind_dir(current_wind, hours)
            shift = angular_difference(current_wind, future_wind)
            if shift >= 12:
                predicted_tack = 'starboard' if angular_difference(future_wind, current_heading) < 90 else 'port'
                suggested_heading = (current_heading + 20) % 360 if predicted_tack == 'starboard' else (current_heading - 20) % 360
                return {
                    "time_to_shift_h": hours,
                    "future_wind_dir": round(future_wind, 1),
                    "shift_deg": round(shift, 1),
                    "tack": predicted_tack,
                    "suggested_heading": round(suggested_heading, 1),
                }
        return {
            "time_to_shift_h": None,
            "future_wind_dir": None,
            "shift_deg": 0,
            "tack": None,
            "suggested_heading": round(current_heading, 1),
        }

    def compute_performance_bias(actual_sog, predicted_polar):
        if actual_sog is not None and actual_sog > 0:
            return round((actual_sog / max(predicted_polar, 0.1)) * 100.0, 1)
        return None

    def is_deep_water(lat_pt, lon_pt):
        if lat_pt is None or lon_pt is None:
            return False
        return not globe.is_land(lat_pt, lon_pt)

    def candidate_point(lat_pt, lon_pt, heading, step_deg=0.35):
        rad = math.radians(heading)
        lat_new = lat_pt + math.cos(rad) * step_deg
        lon_new = lon_pt + math.sin(rad) * step_deg / max(math.cos(math.radians(lat_pt)), 0.01)
        return lat_new, lon_new

    # Extract wind from field at starting position
    avg_u = np.mean([w['u'] for w in wind_field])
    avg_v = np.mean([w['v'] for w in wind_field])
    wind_speed = math.sqrt(avg_u**2 + avg_v**2)
    wind_dir = (math.degrees(math.atan2(-avg_u, -avg_v)) + 360) % 360
    forecast_shift = (forecast_hour / 24.0) * 40.0
    wind_dir = (wind_dir + forecast_shift) % 360
    tws = wind_speed if wind_speed > 0.1 else 18.5
    tws = tws * (1.0 + 0.04 * math.sin(math.radians(forecast_hour * 9)))

    boat_sog = None
    raw_boat_sog = data.get("boat_sog")
    if raw_boat_sog is not None:
        try:
            boat_sog = float(raw_boat_sog)
        except (TypeError, ValueError):
            boat_sog = None

    dest_lat, dest_lon = 32.3078, -64.7505
    initial_heading = heading_between(lat, lon, dest_lat, dest_lon)
    current_u, current_v = nearest_current_vector(lat, lon)
    vmc_solution = find_vmc_heading(initial_heading, current_u, current_v)
    next_maneuver = next_maneuver_forecast(vmc_solution["heading"], wind_dir)

    current_compensation = None
    if current_v > 0.25:
        current_compensation = "Current pushing north — steer slightly south to compensate."
    elif current_v < -0.25:
        current_compensation = "Current pushing south — steer slightly north to compensate."
    elif current_u > 0.25:
        current_compensation = "Current pushing east — steer slightly west to compensate."
    elif current_u < -0.25:
        current_compensation = "Current pushing west — steer slightly east to compensate."

    points = [[lat, lon]]
    curr_lat, curr_lon = lat, lon

    optimal_heading = heading_between(curr_lat, curr_lon, dest_lat, dest_lon)
    last_vmg = 0.0
    last_twa = 120

    for _ in range(20):
        dest_heading = heading_between(curr_lat, curr_lon, dest_lat, dest_lon)
        current_u, current_v = nearest_current_vector(curr_lat, curr_lon)
        vmc = find_vmc_heading(dest_heading, current_u, current_v)
        best_score = -999.0
        best_point = None
        best_heading = vmc["heading"]
        best_twa = vmc["twa"]
        best_speed = vmc["speed"]

        for offset in range(-60, 61, 10):
            heading = (dest_heading + offset) % 360
            twa = angular_difference(wind_dir, heading)
            speed = polar_speed(twa, tws)
            next_lat, next_lon = candidate_point(curr_lat, curr_lon, heading)
            next_lat += current_v * 0.027
            next_lon += current_u * 0.027 / max(math.cos(math.radians(curr_lat)), 0.01)

            if not is_deep_water(next_lat, next_lon) and (len(points) > 0 and (next_lat, next_lon) != (dest_lat, dest_lon)):
                continue

            rad = math.radians(heading)
            boat_x = math.sin(rad) * speed
            boat_y = math.cos(rad) * speed
            dest_rad = math.radians(dest_heading)
            dest_unit_x = math.sin(dest_rad)
            dest_unit_y = math.cos(dest_rad)
            ground_x = boat_x + current_u
            ground_y = boat_y + current_v
            score = ground_x * dest_unit_x + ground_y * dest_unit_y

            if score > best_score:
                best_score = score
                best_point = (next_lat, next_lon)
                best_heading = heading
                best_twa = twa
                best_speed = speed

        if best_point is None:
            for offset in range(0, 360, 30):
                fallback_heading = (vmc["heading"] + offset) % 360
                candidate = candidate_point(curr_lat, curr_lon, fallback_heading)
                if is_deep_water(candidate[0], candidate[1]):
                    best_point = candidate
                    best_heading = fallback_heading
                    best_twa = angular_difference(wind_dir, best_heading)
                    best_speed = polar_speed(best_twa, tws)
                    break

        if best_point is None:
            best_point = candidate_point(curr_lat, curr_lon, vmc["heading"])
            best_heading = vmc["heading"]
            best_twa = vmc["twa"]
            best_speed = vmc["speed"]

        curr_lat, curr_lon = best_point
        points.append([curr_lat, curr_lon])
        last_vmg = best_score
        last_twa = best_twa
        optimal_heading = best_heading

    if points:
        points[-1] = [dest_lat, dest_lon]

    polar_sog = vmc_solution["speed"]
    performance_bias = compute_performance_bias(boat_sog, polar_sog)
    if performance_bias is None:
        performance_bias = round((last_vmg / max(polar_sog, 0.1)) * 100.0, 1)

    current_speed = 0.0
    if current_field.get("has_vector_data") and current_field.get("vectors"):
        current_speed = max(math.hypot(v["u"], v["v"]) for v in current_field["vectors"])
    elif current_field.get("zones"):
        current_speed = max(zone.get("intensity", 0.0) for zone in current_field["zones"])

    fastest_zone = current_field.get("fastest_zone") or (current_field.get("zones") and max(current_field["zones"], key=lambda z: z.get("intensity", 0.0)))

    return {
        "points": points,
        "metadata": {
            "fastest_current_area": fastest_zone,
            "current_compensation": current_compensation,
            "wind_speed": f"{round(wind_speed, 1)} kts",
            "wind_dir": f"{round(wind_dir)}°",
            "current_velocity": f"{round(current_speed, 1)} kts",
            "vmg": f"{round(last_vmg, 1)} kts",
            "twa": f"{round(last_twa)}°",
            "tws": f"{round(tws, 1)} kts",
            "cog": f"{round(optimal_heading)}°",
            "opt_heading": f"{round(dest_heading)}°",
            "vmc_heading": f"{round(vmc_solution['heading'])}°",
            "vmc_vmg": f"{round(vmc_solution['score'], 1)} kts",
            "polar_sog": f"{round(polar_sog, 1)} kts",
            "performance_bias": f"{round(performance_bias, 1)}%",
            "boat_sog": f"{boat_sog} kts" if boat_sog is not None else "N/A",
            "next_maneuver": next_maneuver,
            "status": "HR53 POLAR ROUTE",
            "wind_field": wind_field,
            "current_field": current_field,
            "sea_temp": sea_temp
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
