import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Camera, CheckCircle2, CircleDashed, ExternalLink,
  LoaderCircle, Plus, RefreshCw, ScanEye, ShieldCheck, SquareParking, Trash2, Video, WifiOff, X
} from 'lucide-react';
import '../vision.css';

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin', ...options,
    headers: { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(options.headers ?? {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? data?.detail ?? 'The request could not be completed.');
  return data;
}

function prettyDate(value) {
  if (!value) return 'No frame received yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'No frame received yet' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function CameraStatus({ status }) {
  const labels = { online: 'Online', offline: 'Offline', configured: 'Setup needed', disabled: 'Disabled' };
  return <span className={`sp-camera-status ${status || 'configured'}`}><i />{labels[status] ?? status ?? 'Unknown'}</span>;
}

export default function VisionPage({ currentUser }) {
  const [lots, setLots] = useState([]);
  const [lotId, setLotId] = useState('');
  const [cameras, setCameras] = useState([]);
  const [slots, setSlots] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [cameraForm, setCameraForm] = useState({ name: '', streamReference: '', confidenceThreshold: '0.25' });
  const [regionSlotId, setRegionSlotId] = useState('');
  const [regionPoints, setRegionPoints] = useState('[[0.1,0.1],[0.4,0.1],[0.4,0.5],[0.1,0.5]]');
  const [streamUrl, setStreamUrl] = useState('');
  const [streamError, setStreamError] = useState('');

  const selectedLot = useMemo(() => lots.find((lot) => lot.id === lotId) ?? null, [lots, lotId]);
  const selectedCamera = useMemo(() => cameras.find((camera) => camera.id === selectedCameraId) ?? null, [cameras, selectedCameraId]);
  const activeRegionRows = selectedCamera?.regions?.filter((region) => region.isActive) ?? [];

  const loadLots = useCallback(async () => {
    const data = await apiRequest('/api/parking/managed-lots');
    const listed = data.lots ?? [];
    setLots(listed);
    setLotId((current) => current && listed.some((item) => item.id === current) ? current : (listed[0]?.id ?? ''));
    return listed;
  }, []);

  const loadLotData = useCallback(async (selectedId, showLoading = false) => {
    if (!selectedId) { setCameras([]); setSlots([]); setSelectedCameraId(''); setLoading(false); return; }
    if (showLoading) setLoading(true);
    try {
      const [cameraData, slotData] = await Promise.all([
        apiRequest(`/api/vision/cameras?parkingLotId=${encodeURIComponent(selectedId)}`),
        apiRequest(`/api/parking/lots/${selectedId}/slots`)
      ]);
      const list = cameraData.cameras ?? [];
      setCameras(list);
      setSlots(slotData.slots ?? []);
      setSelectedCameraId((current) => current && list.some((item) => item.id === current) ? current : (list[0]?.id ?? ''));
      setError('');
    } catch (requestError) {
      setError(requestError.message || 'Unable to load camera configuration.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiRequest('/api/parking/managed-lots')
      .then((data) => {
        if (!active) return;
        const listed = data.lots ?? [];
        setLots(listed);
        setLotId(listed[0]?.id ?? '');
        setError('');
      })
      .catch((requestError) => { if (active) setError(requestError.message || 'Unable to load your managed parking facilities.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (lotId) loadLotData(lotId, true);
  }, [lotId, loadLotData]);

  useEffect(() => {
    if (!lotId) return undefined;
    const id = window.setInterval(() => loadLotData(lotId, false), 10000);
    return () => window.clearInterval(id);
  }, [lotId, loadLotData]);

  useEffect(() => {
    setStreamUrl('');
    setStreamError('');
    if (!selectedCamera || selectedCamera.status !== 'online') return;
    let active = true;
    apiRequest(`/api/vision/cameras/${selectedCamera.id}/stream-ticket`)
      .then((data) => { if (active) setStreamUrl(`/vision-stream/${selectedCamera.id}?ticket=${encodeURIComponent(data.ticket)}`); })
      .catch((requestError) => { if (active) setStreamError(requestError.message || 'Live preview is not available.'); });
    return () => { active = false; };
  }, [selectedCameraId, selectedCamera?.status]);

  useEffect(() => {
    if (!selectedCamera) { setRegionSlotId(''); return; }
    const mapped = new Set((selectedCamera.regions ?? []).filter((region) => region.isActive).map((region) => region.slotId));
    const firstUnmapped = slots.find((slot) => !mapped.has(slot.id));
    setRegionSlotId((current) => current && slots.some((slot) => slot.id === current) ? current : (firstUnmapped?.id ?? slots[0]?.id ?? ''));
  }, [selectedCameraId, slots.length, selectedCamera?.regionCount]);

  async function refresh() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await loadLots();
      if (lotId) await loadLotData(lotId, false);
    } catch (requestError) {
      setError(requestError.message || 'Refresh failed.');
    } finally { setBusy(false); }
  }

  function updateCameraForm(event) {
    setCameraForm((old) => ({ ...old, [event.target.name]: event.target.value }));
  }

  async function createCamera(event) {
    event.preventDefault();
    if (!lotId) return setError('Choose a managed facility first.');
    setBusy(true); setError(''); setNotice('');
    try {
      const data = await apiRequest('/api/vision/cameras', {
        method: 'POST', body: JSON.stringify({ parkingLotId: lotId, name: cameraForm.name, streamReference: cameraForm.streamReference, detectorMode: 'yolo', confidenceThreshold: Number(cameraForm.confidenceThreshold) })
      });
      setNotice(data.message || 'Camera created.');
      setCameraForm({ name: '', streamReference: '', confidenceThreshold: '0.25' });
      setShowCreate(false);
      await loadLotData(lotId, false);
      if (data.cameraId) setSelectedCameraId(data.cameraId);
    } catch (requestError) { setError(requestError.message || 'Unable to create camera.'); }
    finally { setBusy(false); }
  }

  async function saveRegion(event) {
    event.preventDefault();
    if (!selectedCamera || !regionSlotId) return setError('Select a camera and parking slot.');
    setBusy(true); setError(''); setNotice('');
    try {
      let points;
      try { points = JSON.parse(regionPoints); } catch { throw new Error('Enter valid JSON coordinates, for example [[0.1,0.1],[0.4,0.1],[0.4,0.5],[0.1,0.5]].'); }
      const data = await apiRequest(`/api/vision/cameras/${selectedCamera.id}/regions`, { method: 'POST', body: JSON.stringify({ slotId: regionSlotId, points }) });
      setNotice(data.message || 'Parking region saved.');
      await loadLotData(lotId, false);
    } catch (requestError) { setError(requestError.message || 'Unable to save region.'); }
    finally { setBusy(false); }
  }

  async function removeRegion(slotId) {
    if (!selectedCamera || !window.confirm('Remove this slot mapping from the selected camera?')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const data = await apiRequest(`/api/vision/cameras/${selectedCamera.id}/regions/${slotId}`, { method: 'DELETE' });
      setNotice(data.message || 'Region removed.');
      await loadLotData(lotId, false);
    } catch (requestError) { setError(requestError.message || 'Unable to remove region.'); }
    finally { setBusy(false); }
  }

  async function setCameraEnabled(camera, enabled) {
    setBusy(true); setError(''); setNotice('');
    try {
      const data = await apiRequest(`/api/vision/cameras/${camera.id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
      setNotice(data.message || (enabled ? 'Camera enabled.' : 'Camera disabled.'));
      await loadLotData(lotId, false);
    } catch (requestError) { setError(requestError.message || 'Unable to update camera.'); }
    finally { setBusy(false); }
  }

  const totalSpaces = slots.length;
  const occupied = slots.filter((slot) => slot.physicalState === 'occupied').length;
  const empty = slots.filter((slot) => slot.physicalState === 'empty').length;
  const unknown = slots.filter((slot) => slot.physicalState === 'unknown').length;
  const roles = currentUser?.roles ?? [];
  const userRoleLabel = roles.includes('admin') ? 'Administrator' : roles.includes('operator') ? 'Facility operator' : 'Parking host';

  return (
    <div className="sp-page sp-vision-page">
      <section className="sp-page-heading">
        <div className="sp-heading-title-row">
          <div><p className="sp-kicker">SMART OCCUPANCY · {userRoleLabel.toUpperCase()}</p><h1>Camera detection</h1><p>Connect a parking camera, map each visible bay to a SmartPark slot, and monitor stable occupancy events.</p></div>
          <div className="sp-heading-actions"><button className="sp-button ghost" onClick={refresh} disabled={busy}><RefreshCw size={14} /> Refresh</button><button className="sp-button primary" onClick={() => setShowCreate((value) => !value)} disabled={!lots.length}><Plus size={15} /> Add camera</button></div>
        </div>
        <div className="sp-vision-notice"><ShieldCheck size={17} /><span>Camera detections update the physical state only. Reservation holds, payments, and facility status still determine whether a space can be booked.</span></div>
      </section>

      {error && <div className="sp-vision-alert error"><AlertTriangle size={16} /><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={14} /></button></div>}
      {notice && <div className="sp-vision-alert success"><CheckCircle2 size={16} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={14} /></button></div>}

      {showCreate && <form className="sp-panel sp-vision-form" onSubmit={createCamera}>
        <div className="sp-panel-header"><div><p className="sp-kicker">NEW CAMERA</p><h2>Connect a video source</h2></div><button type="button" className="sp-icon-quiet" onClick={() => setShowCreate(false)} aria-label="Close form"><X size={17} /></button></div>
        <div className="sp-vision-form-grid">
          <label>Camera name<input name="name" required minLength="2" maxLength="120" value={cameraForm.name} onChange={updateCameraForm} placeholder="North entrance camera" /></label>
          <label>Video source<input name="streamReference" required maxLength="500" value={cameraForm.streamReference} onChange={updateCameraForm} placeholder="0 or parking-lot.mp4" /><small>Use a webcam index (0), a video filename inside the vision sample-videos folder, or an approved RTSP URL.</small></label>
          <label>Detection confidence<select name="confidenceThreshold" value={cameraForm.confidenceThreshold} onChange={updateCameraForm}><option value="0.2">0.20 · More sensitive</option><option value="0.25">0.25 · Recommended start</option><option value="0.35">0.35</option><option value="0.5">0.50 · More conservative</option></select></label>
        </div>
        <p className="sp-vision-muted">Only administrators, facility owners and assigned operators may configure sources. The vision service must have access to the camera source.</p>
        <button type="submit" className="sp-button primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />} Create camera</button>
      </form>}

      {!loading && !lots.length && <div className="sp-panel sp-vision-empty"><Camera size={29} /><h2>No managed facilities</h2><p>Create a parking facility first, or ask an administrator to assign you as its operator.</p></div>}

      {lots.length > 0 && <>
        <section className="sp-panel sp-vision-lot-select">
          <div><p className="sp-kicker">FACILITY</p><h2>Choose parking location</h2><p>Camera slots are mapped to physical spaces in this facility.</p></div>
          <select aria-label="Parking facility" value={lotId} onChange={(event) => setLotId(event.target.value)}>{lots.map((lot) => <option key={lot.id} value={lot.id}>{lot.name} · {lot.city} · {lot.facilityStatus}</option>)}</select>
        </section>

        <section className="sp-vision-metrics">
          <article className="sp-vision-metric"><span className="sp-vision-metric-icon"><Camera size={17} /></span><div><small>Configured cameras</small><strong>{cameras.length}</strong></div></article>
          <article className="sp-vision-metric"><span className="sp-vision-metric-icon online"><Activity size={17} /></span><div><small>Online cameras</small><strong>{cameras.filter((camera) => camera.status === 'online').length}</strong></div></article>
          <article className="sp-vision-metric"><span className="sp-vision-metric-icon occupied"><CarFrontIcon /></span><div><small>Detected occupied</small><strong>{occupied}</strong></div></article>
          <article className="sp-vision-metric"><span className="sp-vision-metric-icon empty"><SquareParking size={17} /></span><div><small>Detected empty</small><strong>{empty}</strong><small>{unknown} unknown of {totalSpaces} total</small></div></article>
        </section>

        {selectedLot && selectedLot.facilityStatus !== 'active' && <div className="sp-vision-alert warning"><AlertTriangle size={16} /><span>This facility is {selectedLot.facilityStatus.replaceAll('_', ' ')}. Camera calibration can run now, but customers cannot discover or book this facility until an administrator activates it.</span></div>}

        <section className="sp-vision-layout">
          <div className="sp-panel sp-vision-camera-list">
            <div className="sp-panel-header"><div><p className="sp-kicker">SOURCES</p><h2>Facility cameras</h2></div><span className="sp-vision-count">{cameras.length}</span></div>
            {loading ? <div className="sp-vision-loading"><LoaderCircle className="spin" size={18} /> Loading camera configuration…</div> : !cameras.length ? <div className="sp-vision-empty small"><Camera size={23} /><p>No cameras configured for this facility.</p><button className="sp-button secondary" onClick={() => setShowCreate(true)}>Add your first camera</button></div> : <div className="sp-vision-camera-items">
              {cameras.map((camera) => <button key={camera.id} className={`sp-vision-camera-item ${camera.id === selectedCameraId ? 'selected' : ''}`} onClick={() => setSelectedCameraId(camera.id)}>
                <span className="sp-vision-camera-icon"><Camera size={18} /></span><span className="sp-vision-camera-copy"><strong>{camera.name}</strong><small>{camera.regionCount} mapped regions · {camera.detectorMode.toUpperCase()}</small><CameraStatus status={camera.status} /></span>
              </button>)}
            </div>}
          </div>

          <div className="sp-panel sp-vision-monitor">
            {selectedCamera ? <>
              <div className="sp-panel-header"><div><p className="sp-kicker">LIVE MONITOR</p><h2>{selectedCamera.name}</h2><p>{selectedCamera.parkingLotName}</p></div><CameraStatus status={selectedCamera.status} /></div>
              <div className="sp-vision-preview">
                {streamUrl && selectedCamera.status === 'online' ? <img src={streamUrl} alt={`Live occupancy detection preview for ${selectedCamera.name}`} onError={() => { setStreamUrl(''); setStreamError('The preview is not available. Check the vision service and camera stream.'); }} /> : <div className="sp-vision-preview-placeholder">{selectedCamera.status === 'online' ? <Video size={35} /> : <WifiOff size={35} />}<strong>{selectedCamera.status === 'online' ? 'Opening live detection preview…' : 'Camera preview unavailable'}</strong><small>{selectedCamera.lastError || streamError || (selectedCamera.status === 'configured' ? 'Map at least one slot region. Install the optional YOLO detector and start the vision service.' : 'Start the vision service and verify that the configured source is accessible.')}</small></div>}
              </div>
              <div className="sp-vision-camera-meta"><span><Activity size={14} /> Last frame: {prettyDate(selectedCamera.lastFrameAt)}</span><span><ScanEye size={14} /> {activeRegionRows.length} active slot mappings</span></div>
              {selectedCamera.lastError && <div className="sp-vision-inline-error"><AlertTriangle size={14} /><span>{selectedCamera.lastError}</span></div>}
              <div className="sp-vision-camera-actions"><button className="sp-button ghost" disabled={busy} onClick={() => setCameraEnabled(selectedCamera, selectedCamera.status === 'disabled')}>{selectedCamera.status === 'disabled' ? 'Enable camera' : 'Disable camera'}</button><button className="sp-button secondary" onClick={() => { setStreamError(''); apiRequest(`/api/vision/cameras/${selectedCamera.id}/stream-ticket`).then((data) => setStreamUrl(`/vision-stream/${selectedCamera.id}?ticket=${encodeURIComponent(data.ticket)}`)).catch((err) => setStreamError(err.message)); }}>Refresh preview</button></div>
            </> : <div className="sp-vision-empty"><Camera size={30} /><h2>Select a camera</h2><p>Create or select a camera to configure its detected parking spaces.</p></div>}
          </div>
        </section>

        {selectedCamera && <section className="sp-vision-layout config">
          <div className="sp-panel sp-vision-region-editor">
            <div className="sp-panel-header"><div><p className="sp-kicker">CALIBRATION</p><h2>Map a parking-space region</h2><p>Each polygon identifies where one slot appears in the camera frame.</p></div><ScanEye size={20} /></div>
            <form onSubmit={saveRegion} className="sp-vision-region-form">
              <label>Parking slot<select required value={regionSlotId} onChange={(event) => setRegionSlotId(event.target.value)}><option value="">Select a slot</option>{slots.map((slot) => <option key={slot.id} value={slot.id}>{slot.slotCode} · {slot.physicalState ?? 'unknown'}</option>)}</select></label>
              <label>Normalized polygon points (JSON)<textarea required rows="5" spellCheck="false" value={regionPoints} onChange={(event) => setRegionPoints(event.target.value)} /></label>
              <small>Use points in clockwise or counter-clockwise order, from 0 to 1. (0,0) is the top-left of the frame and (1,1) is bottom-right. Example: [[0.1,0.1],[0.4,0.1],[0.4,0.5],[0.1,0.5]].</small>
              <button type="submit" className="sp-button primary" disabled={busy || !regionSlotId}>{busy ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />} Save slot region</button>
            </form>
          </div>

          <div className="sp-panel sp-vision-region-list">
            <div className="sp-panel-header"><div><p className="sp-kicker">MAPPED SPACE INVENTORY</p><h2>Active regions</h2></div><span className="sp-vision-count">{activeRegionRows.length}</span></div>
            {!activeRegionRows.length ? <div className="sp-vision-empty small"><CircleDashed size={23} /><p>No slot regions have been configured for this camera.</p></div> : <div className="sp-vision-region-items">{activeRegionRows.map((region) => {
              const slot = slots.find((item) => item.id === region.slotId);
              const state = slot?.physicalState ?? 'unknown';
              return <div className="sp-vision-region-item" key={region.slotId}><span className={`sp-vision-state-dot ${state}`} /><span className="sp-vision-region-label"><strong>{region.slotCode}</strong><small>{region.points.length} polygon points · {state}</small></span><button className="sp-icon-quiet danger" title={`Remove mapping for ${region.slotCode}`} disabled={busy} onClick={() => removeRegion(region.slotId)}><Trash2 size={14} /></button></div>;
            })}</div>}
          </div>
        </section>}

        <section className="sp-panel sp-vision-slot-panel">
          <div className="sp-panel-header"><div><p className="sp-kicker">PHYSICAL INVENTORY</p><h2>Current slot states</h2><p>Automatically refreshed every 10 seconds from SmartPark's inventory API.</p></div><ExternalLink size={18} /></div>
          {!slots.length ? <div className="sp-vision-empty small"><SquareParking size={23} /><p>This facility has no parking spaces yet. Add spaces under Parking spaces.</p></div> : <div className="sp-vision-slot-grid">{slots.map((slot) => <div key={slot.id} className={`sp-vision-slot ${slot.physicalState || 'unknown'}`}><strong>{slot.slotCode}</strong><span>{(slot.physicalState || 'unknown').toUpperCase()}</span><small>{slot.availabilityState === 'available' ? 'Bookable now' : slot.availabilityState === 'reserved' ? 'Reserved' : slot.availabilityState === 'disabled' ? 'Disabled' : slot.availabilityState === 'maintenance' ? 'Maintenance' : 'Not bookable'}</small></div>)}</div>}
        </section>

        <section className="sp-vision-footnote"><ShieldCheck size={16} /><p>YOLO classifies vehicles in mapped polygons; consecutive frame stabilization avoids brief status flicker. An “empty” detection is only physical evidence. SmartPark's booking conflict, operational status and facility rules remain authoritative.</p></section>
      </>}
    </div>
  );
}

function CarFrontIcon() {
  return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 11 1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11"/><path d="M3 14v-1a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1"/><path d="M5 14h14v4H5z"/><path d="M7 18v1m10-1v1M7 14h.01M17 14h.01"/></svg>;
}
