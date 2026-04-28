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

# --- CONFIG ---
GRIB_FILE = "latest_wind.grib2"
DEST_LAT = 32.3078
DEST_LON = -64.7505

# 1. FIXED: Increased time limit for the full crossing
MAX_ROUTING_HOURS = 120 

# ... (keep your existing download_weather, load_grib, sample_grid, etc.)

def bearing(lat1, lon1, lat2, lon2):
    """Calculates the bearing between two points."""
    dlon = math.radians(lon2 - lon1)
    lat1r = math.radians(lat1)
    lat2r = math.radians(lat2)
    y = math.sin(dlon) * math.cos(lat2r)
    x = math.cos(lat1r) * math.sin(lat2r) - math.sin(lat1r) * math.cos(lat2r) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

def plan_isochrone(start_lat, start_lon, end_lat, end_lon, wind_field, current_field, forecast_hour):
    points = [[round(start_lat, 6), round(start_lon, 6)]]
    lat_pt, lon_pt = start_lat, start_lon
    total_nm = 0.0
    total_hours = 0
    
    # Initial Compass Bearing
    initial_bearing = bearing(start_lat, start_lon, end_lat, end_lon)
    last_heading = initial_bearing

    # 1. FIXED: Loop now allows for multi-day trips
    while total_hours < MAX_ROUTING_HOURS:
        distance = haversine_nm(lat_pt, lon_pt, end_lat, end_lon)
        if distance <= 8: # Arrived within 8nm
            break
            
        wind_dir, tws, wind_speed = wind_at(lat_pt, lon_pt, wind_field)
        current_u, current_v = current_at(lat_pt, lon_pt, current_field.get("vectors", []))
        phase = compute_phase(lat_pt, lon_pt)
        
        target_bearing = bearing(lat_pt, lon_pt, end_lat, end_lon)
        best = find_vmc_heading(target_bearing, current_u, current_v, wind_dir, tws, phase)
        
        speed = max(0.4, best["speed"] * 1.05) # Buffed speed for visualization
        
        next_lat, next_lon = project_point(lat_pt, lon_pt, best["heading"], speed, 3.0)
        
        # Land avoidance
        if point_on_land(next_lat, next_lon):
            # Simple bounce logic
            best["heading"] = (best["heading"] + 20) % 360
            next_lat, next_lon = project_point(lat_pt, lon_pt, best["heading"], speed, 3.0)

        points.append([round(next_lat, 6), round(next_lon, 6)])
        total_nm += speed * 3.0
        total_hours += 3
        lat_pt, lon_pt = next_lat, next_lon
        last_heading = best["heading"]

    return {
        "points": points,
        "duration_h": total_hours,
        "distance_nm": round(total_nm, 1),
        "heading": round(last_heading, 1), # 2. COMPASS: The current optimized heading
        "target_bearing": round(initial_bearing, 1), # 2. COMPASS: The direct line bearing
        "phase": compute_phase(lat_pt, lon_pt),
    }

@app.post("/isochrone")
async def calculate_route(data: dict):
    # ... (keep your data extraction)
    
    route = plan_isochrone(start_lat, start_lon, end_lat, end_lon, wind_field, current_field, forecast_hour)
    
    # 3. COMPASS INCORPORATION: Send these to the frontend
    return {
        "points": route["points"],
        "metadata": {
            "cog": route["heading"],              # Course Over Ground
            "bearing": route["target_bearing"],    # Direct line to Bermuda
            "opt_heading": route["heading"],       # Best VMC heading
            "status": f"{route['phase']} phase",
            "eta_h": route["duration_h"],
            # ... (rest of your metadata)
        }
    }

# 3. FIXED: The Entry Point
if __name__ == "__main__":
    # Ensure dependencies are handled
    print("⚓ Starting Momentum Backend...")
    uvicorn.run(app, host="0.0.0.0", port=8000)
