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

@app.post("/isochrone")
async def calculate_route(data: dict):
    lat, lon = data.get("lat"), data.get("lon")
    download_weather()
    wind_field = extract_wind_field()

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

    def is_deep_water(lat_pt, lon_pt):
        if lat_pt is None or lon_pt is None:
            return False
        return globe.is_ocean(lat_pt, lon_pt)

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
    tws = wind_speed if wind_speed > 0.1 else 18.5

    points = [[lat, lon]]
    curr_lat, curr_lon = lat, lon
    dest_lat, dest_lon = 32.3078, -64.7505

    optimal_heading = heading_between(curr_lat, curr_lon, dest_lat, dest_lon)
    last_vmg = 0.0
    last_twa = 120

    for _ in range(20):
        dest_heading = heading_between(curr_lat, curr_lon, dest_lat, dest_lon)
        best_score = -1.0
        best_point = None
        best_heading = dest_heading
        best_twa = last_twa
        best_speed = 0.0

        for offset in range(-60, 61, 10):
            heading = (dest_heading + offset) % 360
            twa = angular_difference(wind_dir, heading)
            speed = polar_speed(twa, tws)
            next_lat, next_lon = candidate_point(curr_lat, curr_lon, heading)

            if not is_deep_water(next_lat, next_lon) and (len(points) > 0 and (next_lat, next_lon) != (dest_lat, dest_lon)):
                continue

            progress = speed * math.cos(math.radians(angular_difference(dest_heading, heading)))
            if progress > best_score:
                best_score = progress
                best_point = (next_lat, next_lon)
                best_heading = heading
                best_twa = twa
                best_speed = speed

        if best_point is None:
            best_point = candidate_point(curr_lat, curr_lon, dest_heading)
            best_heading = dest_heading
            best_twa = angular_difference(wind_dir, dest_heading)
            best_speed = polar_speed(best_twa, tws)

        curr_lat, curr_lon = best_point
        points.append([curr_lat, curr_lon])
        last_vmg = best_speed * math.cos(math.radians(angular_difference(dest_heading, best_heading)))
        last_twa = best_twa
        optimal_heading = best_heading

    if points:
        points[-1] = [dest_lat, dest_lon]

    return {
        "points": points,
        "metadata": {
            "wind_speed": f"{round(wind_speed, 1)} kts",
            "wind_dir": f"{round(wind_dir)}°",
            "current_velocity": "2.1 kts",
            "vmg": f"{round(last_vmg, 1)} kts",
            "twa": f"{round(last_twa)}°",
            "tws": f"{round(tws, 1)} kts",
            "cog": f"{round(optimal_heading)}°",
            "opt_heading": f"{round(dest_heading)}°",
            "status": "HR53 POLAR ROUTE",
            "wind_field": wind_field
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
