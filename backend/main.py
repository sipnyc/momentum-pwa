import os
import math
import requests
import numpy as np
import xarray as xr
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from global_land_mask import globe

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# --- CONFIGURATION ---
GRIB_FILE = "latest_wind.grib2"
DEST_LAT = 32.3078
DEST_LON = -64.7505
MAX_ROUTING_HOURS = 120  # FIX: Increased to 5 days for the full crossing

PHASE_WEIGHTS = {"Chesapeake": 1.04, "Gulf Stream": 1.15, "Approach": 0.98}

# --- MATH UTILITIES ---

def bearing(lat1, lon1, lat2, lon2):
    """Calculates the compass bearing between two points."""
    dlon = math.radians(lon2 - lon1)
    lat1r = math.radians(lat1)
    lat2r = math.radians(lat2)
    y = math.sin(dlon) * math.cos(lat2r)
    x = math.cos(lat1r) * math.sin(lat2r) - math.sin(lat1r) * math.cos(lat2r) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

def haversine_nm(lat1, lon1, lat2, lon2):
    """Distance in Nautical Miles."""
    r_nm = 3440.065
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi, dlambda = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dphi / 2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2)**2
    return r_nm * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))

# --- WEATHER DATA ---

def download_weather():
    """Downloads GFS wind data from NOAA."""
    if not os.path.exists(GRIB_FILE):
        print("Downloading Atlantic wind data (GFS)...")
        url = (
            "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?"
            "file=gfs.t00z.pgrb2.0p25.f000&lev_10_m_above_ground=on&var_UGRD=on&var_VGRD=on&"
            "subregion=&leftlon=-80&rightlon=-60&toplat=45&bottomlat=30"
        )
        try:
            r = requests.get(url, timeout=40)
            r.raise_for_status()
            with open(GRIB_FILE, "wb") as f:
                f.write(r.content)
            print("Download Complete.")
        except Exception as e:
            print(f"Download failed: {e}")

def get_wind_at(lat, lon, ds):
    """Extracts wind speed and direction from the loaded GRIB dataset."""
    try:
        # Dynamically find U and V components
        u_key = [k for k in ds.data_vars if 'u' in k.lower()][0]
        v_key = [k for k in ds.data_vars if 'v' in v.lower()][0]
        
        u = float(ds[u_key].sel(latitude=lat, longitude=lon, method="nearest").values)
        v = float(ds[v_key].sel(latitude=lat, longitude=lon, method="nearest").values)
        
        speed = math.hypot(u, v) * 1.94384  # Convert m/s to Knots
        direction = (math.degrees(math.atan2(-u, -v)) + 360) % 360
        return direction, speed
    except:
        return 240.0, 15.0 # Fallback

# --- ROUTING ENGINE ---

def plan_isochrone(start_lat, start_lon, end_lat, end_lon, ds):
    points = [[round(start_lat, 6), round(start_lon, 6)]]
    curr_lat, curr_lon = start_lat, start_lon
    total_hours = 0
    total_nm = 0
    
    # Calculate the straight-line bearing to Bermuda once
    initial_bearing = bearing(start_lat, start_lon, end_lat, end_lon)

    while total_hours < MAX_ROUTING_HOURS:
        dist_to_go = haversine_nm(curr_lat, curr_lon, end_lat, end_lon)
        if dist_to_go < 5: break # Arrived!

        wind_dir, tws = get_wind_at(curr_lat, curr_lon, ds)
        target_brg = bearing(curr_lat, curr_lon, end_lat, end_lon)
        
        # Simple Polar logic: Boats go faster at 110 degrees to the wind
        opt_heading = (wind_dir + 110) % 360 if target_brg > wind_dir else (wind_dir - 110) % 360
        
        # Move the boat (Speed approx 8kts adjusted by phase)
        speed = 8.5
        delta_lat = (speed * 3 * math.cos(math.radians(opt_heading))) / 60.0
        delta_lon = (speed * 3 * math.sin(math.radians(opt_heading))) / (60.0 * math.cos(math.radians(curr_lat)))
        
        curr_lat += delta_lat
        curr_lon += delta_lon
        
        points.append([round(curr_lat, 6), round(curr_lon, 6)])
        total_hours += 3
        total_nm += (speed * 3)

    return {
        "points": points,
        "heading": round(opt_heading, 1),
        "bearing": round(initial_bearing, 1),
        "distance": round(total_nm, 1),
        "duration": total_hours
    }

# --- API ROUTES ---

@app.post("/isochrone")
async def calculate_route(data: dict):
    download_weather()
    
    start_lat = data.get("lat", 38.9784)
    start_lon = data.get("lon", -76.4922)

    try:
        ds = xr.open_dataset(GRIB_FILE, engine='cfgrib')
        route = plan_isochrone(start_lat, start_lon, DEST_LAT, DEST_LON, ds)
    except Exception as e:
        return {"error": f"GRIB processing failed: {e}"}

    return {
        "points": route["points"],
        "metadata": {
            "cog": route["heading"],            # Green Needle
            "bearing": route["bearing"],        # Dashboard Label
            "opt_heading": route["heading"],    # Blue Needle
            "status": "Racing",
            "eta_adjusted_h": route["duration"],
            "distance_nm": route["distance"]
        }
    }

# --- THE ENGINE START ---
if __name__ == "__main__":
    print("⚓ Momentum Backend is starting up...")
    uvicorn.run(app, host="0.0.0.0", port=8000)
