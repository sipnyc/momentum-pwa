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
            
            # Create a denser grid sampling of the wind field for lookups.
            grid = []
            lat_stride = max(1, len(lats) // 12)
            lon_stride = max(1, len(lons) // 18)

            for i in range(0, len(lats), lat_stride):
                for j in range(0, len(lons), lon_stride):
                    lat = float(lats[i])
                    lon = float(lons[j])
                    u_val = float(u[i, j]) if i < u.shape[0] and j < u.shape[1] else 0.0
                    v_val = float(v[i, j]) if i < v.shape[0] and j < v.shape[1] else 0.0
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
    current_u, current_v = get_local_current(lat, lon)
    current_wind = get_local_wind(lat, lon, forecast_hour)
    vmc_solution = find_vmc_heading(initial_heading, current_u, current_v)
    next_maneuver = next_maneuver_forecast(vmc_solution["heading"], current_wind["dir"])

    current_compensation = None
    if current_v > 0.25:
        current_compensation = "Current pushing north — steer slightly south to compensate."
    elif current_v < -0.25:
        current_compensation = "Current pushing south — steer slightly north to compensate."
    elif current_u > 0.25:
        current_compensation = "Current pushing east — steer slightly west to compensate."
    elif current_u < -0.25:
        current_compensation = "Current pushing west — steer slightly east to compensate."

    def distance_nm(lat1, lon1, lat2, lon2):
        dlat = (lat2 - lat1) * 60.0
        dlon = (lon2 - lon1) * 60.0 * math.cos(math.radians((lat1 + lat2) / 2.0))
        return math.hypot(dlat, dlon)

    def quantize_point(lat_pt, lon_pt, precision=2):
        return f"{round(lat_pt, precision)}:{round(lon_pt, precision)}"

    def project_position(lat_pt, lon_pt, heading, boat_speed, current_u, current_v, hours=3.0):
        rad = math.radians(heading)
        boat_x = math.sin(rad) * boat_speed * hours
        boat_y = math.cos(rad) * boat_speed * hours
        ground_x = boat_x + current_u * hours
        ground_y = boat_y + current_v * hours
        new_lat = lat_pt + ground_y / 60.0
        new_lon = lon_pt + ground_x / (60.0 * max(math.cos(math.radians(lat_pt)), 0.15))
        return new_lat, new_lon

    def get_local_current(lat_pt, lon_pt):
        if current_field.get("has_vector_data") and current_field.get("vectors"):
            best = min(
                current_field["vectors"],
                key=lambda item: (item.get("lat", 0.0) - lat_pt) ** 2 + (item.get("lon", 0.0) - lon_pt) ** 2
            )
            return best.get("u", 0.0), best.get("v", 0.0)

        zones = current_field.get("zones", [])
        if zones:
            best_zone = max(zones, key=lambda z: z.get("intensity", 0.0))
            intensity = best_zone.get("intensity", 0.0)
            return intensity * 0.35, intensity * 0.10

        return 0.0, 0.0

    def find_vmc_heading(destination_heading, current_u=0.0, current_v=0.0, wind=None):
        dest_rad = math.radians(destination_heading)
        dest_unit_x = math.sin(dest_rad)
        dest_unit_y = math.cos(dest_rad)
        best = {"heading": destination_heading, "score": -999.0, "speed": 0.0, "twa": 0.0}
        wind_speed = wind.get("speed", tws) if wind else tws
        wind_dir = wind.get("dir", wind_dir) if wind else wind_dir
        for offset in range(-80, 81, 5):
            heading = (destination_heading + offset) % 360
            twa = angular_difference(wind_dir, heading)
            speed = polar_speed(twa, wind_speed)
            rad = math.radians(heading)
            boat_x = math.sin(rad) * speed
            boat_y = math.cos(rad) * speed
            ground_x = boat_x + current_u
            ground_y = boat_y + current_v
            score = ground_x * dest_unit_x + ground_y * dest_unit_y
            if score > best["score"]:
                best = {"heading": heading, "score": score, "speed": speed, "twa": twa, "ground_speed": math.hypot(ground_x, ground_y)}
        return best

    def make_candidates(node, step_index):
        wind = get_local_wind(node["lat"], node["lon"], forecast_hour + step_index * 3)
        current_u, current_v = get_local_current(node["lat"], node["lon"])
        heading_to_dest = heading_between(node["lat"], node["lon"], dest_lat, dest_lon)
        vmc = find_vmc_heading(heading_to_dest, current_u, current_v, wind)
        base_headings = {
            heading_to_dest,
            vmc["heading"],
            (heading_to_dest + 15) % 360,
            (heading_to_dest - 15) % 360,
            (heading_to_dest + 30) % 360,
            (heading_to_dest - 30) % 360,
            (heading_to_dest + 45) % 360,
            (heading_to_dest - 45) % 360,
        }

        candidates = []
        dist_from_dest = distance_nm(node["lat"], node["lon"], dest_lat, dest_lon)
        for heading in base_headings:
            twa = angular_difference(wind["dir"], heading)
            boat_speed = polar_speed(twa, wind["speed"])
            if boat_speed < 2.5:
                continue
            next_lat, next_lon = project_position(node["lat"], node["lon"], heading, boat_speed, current_u, current_v, 3)
            if not is_deep_water(next_lat, next_lon):
                continue
            dist_to_dest = distance_nm(next_lat, next_lon, dest_lat, dest_lon)
            progress = max(0.0, dist_from_dest - dist_to_dest)
            heading_penalty = abs(angular_difference(heading, heading_to_dest)) / 90.0
            vmc_bonus = -0.18 if abs(angular_difference(heading, vmc["heading"])) < 12 else 0.0
            score = node["time"] + 3 + dist_to_dest / max(1.0, boat_speed + 1.5) + heading_penalty + vmc_bonus
            candidates.append({
                "lat": next_lat,
                "lon": next_lon,
                "time": node["time"] + 3,
                "heading": heading,
                "twa": twa,
                "boat_speed": boat_speed,
                "ground_speed": math.hypot(math.sin(math.radians(heading)) * boat_speed + current_u, math.cos(math.radians(heading)) * boat_speed + current_v),
                "dist_to_dest": dist_to_dest,
                "score": score,
                "prev": node,
            })
        return candidates

    start_key = quantize_point(lat, lon, precision=2)
    best_nodes = {start_key: {"lat": lat, "lon": lon, "time": 0, "prev": None, "heading": initial_heading, "score": 0.0}}
    frontier = [best_nodes[start_key]]
    max_frontier = 200
    max_steps = 18

    for step_index in range(max_steps):
        next_frontier = {}
        for node in frontier:
            for candidate in make_candidates(node, step_index):
                key = quantize_point(candidate["lat"], candidate["lon"], precision=2)
                existing = next_frontier.get(key) or best_nodes.get(key)
                if existing is None or candidate["score"] < existing.get("score", float("inf")):
                    next_frontier[key] = candidate
        if not next_frontier:
            break
        frontier = sorted(next_frontier.values(), key=lambda item: (item["score"], item["time"]))[:max_frontier]
        best_nodes.update({quantize_point(node["lat"], node["lon"], precision=2): node for node in frontier})

    final_node = None
    final_score = float("inf")
    for node in best_nodes.values():
        dist = distance_nm(node["lat"], node["lon"], dest_lat, dest_lon)
        est = node["time"] + dist / max(1.0, node.get("boat_speed", tws) + 1.0)
        if est < final_score:
            final_score = est
            final_node = node

    if final_node is None:
        final_node = best_nodes[start_key]

    path = []
    node = final_node
    while node:
        path.append([node["lat"], node["lon"]])
        node = node.get("prev")
    path = list(reversed(path))
    if path and distance_nm(path[-1][0], path[-1][1], dest_lat, dest_lon) <= 8.0:
        path[-1] = [dest_lat, dest_lon]
    else:
        path.append([dest_lat, dest_lon])

    total_hours = final_node["time"]
    polar_sog = vmc_solution["speed"]
    performance_bias = compute_performance_bias(boat_sog, polar_sog)
    if performance_bias is None:
        performance_bias = round((polar_sog / max(polar_sog, 0.1)) * 100.0, 1)

    efficiency_pct = performance_bias
    adjusted_eta = total_hours
    if efficiency_pct is not None and efficiency_pct > 0:
        adjusted_eta = total_hours / (efficiency_pct / 100.0)
    eta_adjusted = round(adjusted_eta, 1)
    eta_hours = round(total_hours, 1)
    eta_with_efficiency = round(eta_adjusted, 1)

    last_vmg = vmc_solution.get("ground_speed", vmc_solution["speed"])
    last_twa = vmc_solution.get("twa", 0.0)
    optimal_heading = vmc_solution["heading"]

    current_speed = 0.0
    if current_field.get("has_vector_data") and current_field.get("vectors"):
        current_speed = max(math.hypot(v["u"], v["v"]) for v in current_field["vectors"])
    elif current_field.get("zones"):
        current_speed = max(zone.get("intensity", 0.0) for zone in current_field["zones"])

    fastest_zone = current_field.get("fastest_zone") or (current_field.get("zones") and max(current_field["zones"], key=lambda z: z.get("intensity", 0.0)))

    return {
        "points": path,
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
            "status": "HR53 ISOCHRONE ROUTE",
            "wind_field": wind_field,
            "current_field": current_field,
            "sea_temp": sea_temp
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
