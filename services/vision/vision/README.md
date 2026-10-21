# SmartPark Vision Service — Phase 7

This is an original Python service for live camera-based parking-space occupancy. It reads camera definitions and slot polygons from the SmartPark API, runs vehicle detection, stabilizes classifications across multiple frames, and posts only state transitions/heartbeats to the API.

## What it does

- Processes webcam indices, local sample-video files, and optionally approved RTSP feeds.
- Uses YOLO/Ultralytics with the COCO classes car, motorcycle, bus and truck.
- Allows normalized polygons per parking space; coordinates use the range 0–1, where `(0,0)` is the top-left and `(1,1)` the bottom-right of the frame.
- Requires consecutive consistent detections before changing a slot's physical state.
- Sends signed-service-token-authenticated occupancy events to `/api/vision/service/events`.
- Marks camera health and errors through `/api/vision/service/cameras/{cameraId}/health`.
- Provides a ticket-protected MJPEG stream for the authenticated web UI at `/vision-stream/{cameraId}`.
- Does not decide whether a slot is bookable; SmartPark's API still checks bookings, facility state and operational availability.

## Local setup (Windows PowerShell)

1. Install Python 3.11 or 3.12. Python 3.13 may work, but your PyTorch/Ultralytics platform wheels should be checked first.
2. From the repository root, make a unique secret and place it in `.env` as `VISION_API_TOKEN`. Use the same value in the API environment and the vision service. Do not use this example value in production.

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

3. Create a virtual environment and install base dependencies:

   ```powershell
   cd services/vision
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install --upgrade pip
   pip install -r requirements-yolo.txt
   ```

   `requirements-yolo.txt` installs Ultralytics and PyTorch, which is larger than the basic web dependencies. For just the health API and pure helper tests, `requirements.txt` is enough, but occupancy detection requires the YOLO extra.

4. In the project root `.env`, configure:

   ```dotenv
   VISION_API_TOKEN=<the-same-random-secret>
   ```

   The service loads the root `.env` automatically. Optional camera-service settings are in `services/vision/.env.example`; copy that file to `services/vision/.env` to override defaults.

5. Apply migrations 001 through 007 in order (or only migration 007 if 001–006 are already applied), then start the Node API and web app in one terminal from the project root:

   ```powershell
   npm run dev
   ```

6. In a second terminal, from `services/vision` with the virtual environment active:

   ```powershell
   python -m uvicorn smartpark_vision.main:app --host 127.0.0.1 --port 8000
   ```

7. Open the web app and go to **Camera detection** as a host, assigned operator or admin. Select an active facility, add a camera, and map each slot to a polygon.

## Video source configuration

- `0` means the first camera physically accessible to the machine running the vision service.
- To use a local video, copy the file into `services/vision/sample-videos` and enter only its filename in the camera source field, such as `parking-demo.mp4`.
- RTSP is disabled by default. To enable it, set `VISION_ALLOW_RTSP=true` only in a trusted deployment network. Ensure the host/network is restricted and never enter a stream URL from an untrusted user.
- For production, set `VISION_MODEL_PATH` to a locally managed `.pt` model file and ensure its license/use terms fit your deployment. `yolov8n.pt` may be downloaded by Ultralytics on the first run if the machine has network access.

## Mapping parking-space regions

In the Camera detection page, select a camera, choose a parking slot, and submit a polygon such as:

```json
[[0.1, 0.1], [0.4, 0.1], [0.4, 0.5], [0.1, 0.5]]
```

Use a polygon around the visible pavement/bay region rather than around an entire vehicle. Add one mapping per physical slot visible to the camera. The live preview draws green for detected empty, red for occupied, and amber for unknown. Mapping coordinates must be recalibrated after the camera position, zoom, or frame aspect ratio changes.

## Endpoints

- `GET /health` — Vision service health and worker snapshots.
- `GET /vision-stream/{cameraId}?ticket=...` — short-lived-ticket-protected MJPEG stream.
- `GET /api/vision/service/config` — called internally by the worker to retrieve configured cameras/regions.
- `POST /api/vision/service/events` — occupancy transitions and heartbeat.
- `POST /api/vision/service/cameras/{cameraId}/health` — worker errors/offline state.

The service-to-service API uses a bearer token that is separate from user session cookies. Do not expose the API token to the browser, commit it, log it, or reuse a payment secret. Video stream tickets are signed with the same token and expire after two minutes; only authenticated, authorized facility staff can request one from the Node API.

## Detection limitations and deployment safety

- Computer vision can miss/false-detect vehicles in glare, rain, night scenes, occlusion or unusual camera views. Evaluate precision/recall for your actual camera/site before using it to control a physical gate or charging decisions.
- Unknown/stale camera data is intentionally not advertised as empty. Slot booking still has to pass the main reservation engine.
- The first version processes cameras in threads and serializes inference through one model lock. Scale out separate service instances or use a GPU-enabled inference service only after measuring throughput.
- Use RTSP only on trusted camera networks; the service validates local files under `VISION_MEDIA_ROOT` to avoid arbitrary local-file reads.
- The web preview requires the Vite `/vision-stream` proxy in development. In production, configure your reverse proxy to route `/vision-stream/` to the internal vision service and keep port 8000 private.
- Restrict the vision service's network exposure to the private network or reverse proxy. API service-token authentication is required for worker endpoints, but network allowlisting remains recommended.
