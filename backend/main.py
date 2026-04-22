from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

app = FastAPI()

# Allow your iPad to talk to this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"Status": "Momentum Backend Active"}

@app.post("/isochrone")
async def calculate_route(data: dict):
    # This is where the Gulf Stream math happens
    lat = data.get("lat")
    lon = data.get("lon")
    print(f"Calculating route from {lat}, {lon}")
    
    # Placeholder for the blue line coordinates
    # In a full build, this returns the actual optimized path
    return {
        "points": [
            [lat, lon],
            [35.0, -70.0],
            [32.3078, -64.7505] # Bermuda
        ],
        "metadata": {"wind_speed": "18kts", "current_set": "045@2.1kt"}
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
