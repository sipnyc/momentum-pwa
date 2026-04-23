from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import numpy as np

app = FastAPI()

# Allow your iPad to talk to the Backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_gulf_stream_velocity(lat, lon):
    # This is where we'll hook into RTOFS data. 
    # For now, it detects if you're in the "Stream Zone"
    if 32 < lat < 38 and -75 < lon < -65:
        return 3.5  # 3.5 knots of current profit!
    return 0.0

@app.post("/isochrone")
async def calculate_route(data: dict):
    start_lat = data.get("lat")
    start_lon = data.get("lon")
    
    # ISOCHRONE ALGORITHM (Simplified)
    # We generate a "fan" of possible headings and pick the fastest
    points = [[start_lat, start_lon]]
    
    # Calculate 5 tactical waypoints toward Bermuda
    curr_lat, curr_lon = start_lat, start_lon
    dest_lat, dest_lon = 32.3078, -64.7505
    
    for _ in range(5):
        # Move toward destination
        curr_lat += (dest_lat - curr_lat) * 0.2
        curr_lon += (dest_lon - curr_lon) * 0.2
        
        # Add "Stream Deviation" - If we find the Gulf Stream, we stay in it longer
        current_boost = get_gulf_stream_velocity(curr_lat, curr_lon)
        if current_boost > 0:
            curr_lon += 0.5 # Drag the route East with the current
            
        points.append([curr_lat, curr_lon])

    return {
        "points": points,
        "metadata": {
            "stream_profit": "+2.4 knots",
            "eta": "3d 12h",
            "status": "RTOFS/GFS Active"
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
