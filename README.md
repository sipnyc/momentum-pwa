# Momentum A2B Navigator

Polar-driven tactical routing PWA for offshore racing. Built for the HR53 (Second Storm) on the Newport–Bermuda corridor.

## What it does

- **Isochrone routing** — fans out 24 headings every 3 hours and finds the fastest path to Bermuda using real HR53 polar data
- **Gulf Stream slingshot** — models the GS current axis and cold eddies; shows live current profit in knots
- **Polar bias** — slide to your actual onboard performance (e.g. 94%) and every future routing calculation adjusts automatically
- **Sail trim advisor** — recommends Main + Jib / Genoa / A2 / A3 Spinnaker based on TWA and TWS polar sweet spots
- **Tactical canvas** — animated wind streamlines, neon current heatmap, and 3 h / 6 h / 12 h isochrone ripple rings on the map
- **Flight computer** — compass rose showing COG (green), OPT heading (blue), and TWD (yellow) needles with digital readout

## Quick start

### 1. Backend

```bash
cd backend
pip install -r requirements.txt
python main.py
```

Runs on `http://localhost:8000`. The `/isochrone` endpoint accepts a POST with `start_lat`, `start_lon`, optional `end_lat`/`end_lon` (defaults to Bermuda), and a `bias` factor (default `1.0`).

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on `http://localhost:5173`. Open in a browser — landscape orientation recommended.

## Polar data

`backend/HR53-Boatspeed.csv` contains the HR53 polar table (TWA 40–180°, TWS 6–20 kt) read from the speed diagram. The backend interpolates bilinearly for any TWA/TWS combination. To use a different boat, swap this file — the header row must be `twa,6,8,10,...` with wind speeds in knots.

## Backend API

| Endpoint | Method | Body | Returns |
|---|---|---|---|
| `/isochrone` | POST | `{start_lat, start_lon, end_lat, end_lon, bias, forecast_hour}` | route points, isochrone fans, metadata |
| `/health` | GET | — | polar TWS range check |

## Project layout

```
momentum-pwa/
├── backend/
│   ├── main.py               # FastAPI routing engine
│   ├── HR53-Boatspeed.csv    # Polar table
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── App.jsx
    │   └── components/
    │       └── GulfStreamMap.jsx   # Main tactical HUD + map
    └── package.json
```

## Requirements

**Backend:** Python 3.9+, FastAPI, uvicorn, numpy, scipy

**Frontend:** Node 18+, React 19, Vite, react-leaflet
