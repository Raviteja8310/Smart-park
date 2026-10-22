import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, CircleHelp, DoorClosed, DoorOpen, LoaderCircle, Plus, RefreshCw, ShieldCheck, Wifi } from 'lucide-react';

async function apiRequest(path, options = {}) {
  const response = await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers??{})}});
  const data = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data?.error?.message ?? 'The gate hardware request failed.');
  return data;
}

export default function GateHardwarePage({ currentUser }) {
  const [lots,setLots] = useState([]);
  const [devices,setDevices] = useState([]);
  const [commands,setCommands] = useState([]);
  const [serviceConfigured,setServiceConfigured] = useState(false);
  const [form,setForm] = useState({parkingLotId:'',deviceName:'',provider:'generic-http-adapter',externalDeviceId:'',supportsEntry:true,supportsExit:true});
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState('');

  const load = useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const [lotData,deviceData,commandData] = await Promise.all([
        apiRequest('/api/parking/managed-lots'),apiRequest('/api/gate-hardware/devices'),apiRequest('/api/gate-hardware/commands/mine')
      ]);
      setLots(lotData.lots??[]);setDevices(deviceData.devices??[]);setCommands(commandData.commands??[]);setServiceConfigured(Boolean(deviceData.hardwareServiceConfigured));
      setForm(current=>({...current,parkingLotId:current.parkingLotId||(lotData.lots?.[0]?.id??'')}));
    }catch(e){setError(e.message||'Unable to load gate devices.');}finally{setLoading(false);}
  },[]);
  useEffect(()=>{load();},[load]);

  async function createDevice(event){
    event.preventDefault();setBusy('create');setError('');setNotice('');
    try{
      const data=await apiRequest('/api/gate-hardware/devices',{method:'POST',body:JSON.stringify({...form,externalDeviceId:form.externalDeviceId.trim()||null})});
      setNotice(data.message||'Gate device registered.');setForm(current=>({...current,deviceName:'',externalDeviceId:''}));await load();
    }catch(e){setError(e.message||'Unable to register the device.');}finally{setBusy('');}
  }

  async function issueCommand(device,commandType){
    const reasons={open:'Authorized operator requested gate open.',close:'Authorized operator requested gate close.',status_check:'Routine gate device status check.'};
    setBusy(`${device.id}:${commandType}`);setError('');setNotice('');
    try{
      const data=await apiRequest(`/api/gate-hardware/devices/${device.id}/commands`,{method:'POST',body:JSON.stringify({commandType,reason:reasons[commandType]})});
      setNotice(data.message||'Command queued.');await load();
    }catch(e){setError(e.message||'Unable to queue the command.');}finally{setBusy('');}
  }

  async function updateStatus(device,deviceStatus){
    setBusy(device.id);setError('');setNotice('');
    try{await apiRequest(`/api/gate-hardware/devices/${device.id}`,{method:'PATCH',body:JSON.stringify({deviceStatus})});setNotice('Device configuration updated.');await load();}
    catch(e){setError(e.message||'Unable to update device.');}finally{setBusy('');}
  }

  const canConfigure=currentUser?.roles?.some(role=>['host','operator','admin'].includes(role));
  if(!canConfigure)return <section className="sp-page"><div className="sp-alert error"><ShieldCheck size={17}/><span>Gate device settings require a facility owner, assigned operator, or administrator account.</span></div></section>;

  return <section className="sp-page sp-gh-page">
    <div className="sp-page-heading"><div><p className="sp-kicker">PHYSICAL ACCESS INTEGRATION</p><h1>Gate hardware</h1><p>Register compatible gate controllers and queue auditable commands for an edge adapter.</p></div><button className="sp-button secondary" onClick={load} disabled={loading}><RefreshCw size={15}/>{loading?'Refreshing…':'Refresh'}</button></div>
    {error&&<div className="sp-alert error"><AlertCircle size={17}/><span>{error}</span><button onClick={()=>setError('')} aria-label="Dismiss error">×</button></div>}
    {notice&&<div className="sp-alert success"><CheckCircle2 size={17}/><span>{notice}</span><button onClick={()=>setNotice('')} aria-label="Dismiss notice">×</button></div>}
    <div className={`sp-gh-adapter-note ${serviceConfigured?'ready':''}`}><span className="sp-gh-adapter-icon">{serviceConfigured?<Wifi size={19}/>:<CircleHelp size={19}/>}</span><div><strong>{serviceConfigured?'Gate adapter credential configured':'Hardware adapter not configured'}</strong><p>{serviceConfigured?'Commands can be picked up by the authenticated adapter, subject to device health and expiry.':'Set GATE_DEVICE_SERVICE_TOKEN in the API environment and run a compatible edge service. Queue requests do not physically open or close a gate by themselves.'}</p></div></div>
    <div className="sp-gh-layout">
      <article className="sp-panel sp-gh-panel"><div className="sp-panel-header"><div><p className="sp-kicker">DEVICE REGISTRY</p><h2>Registered gate devices</h2><p>Devices remain configured until the connected adapter reports a heartbeat.</p></div><Activity size={20}/></div>
        <div className="sp-gh-device-list">{devices.map(device=><div className="sp-gh-device" key={device.id}>
          <div className="sp-gh-device-head"><span className={`sp-gh-status ${device.deviceStatus}`}/><div className="sp-gh-device-title"><strong>{device.deviceName}</strong><small>{device.parkingLotName} · {device.provider}{device.externalDeviceId?` · ${device.externalDeviceId}`:''}</small></div><select aria-label={`Status for ${device.deviceName}`} value={device.deviceStatus==='online'?'online':device.deviceStatus} onChange={e=>updateStatus(device,e.target.value)} disabled={busy===device.id}><option value="configured">Configured</option><option value="offline">Offline</option><option value="disabled">Disabled</option>{device.deviceStatus==='online'&&<option value="online" disabled>Online · adapter controlled</option>}</select></div>
          <div className="sp-gh-device-meta"><span>{device.supportsEntry?'Entry supported':'No entry control'}</span><span>{device.supportsExit?'Exit supported':'No exit control'}</span><span>{device.lastSeenAt?`Heartbeat ${new Date(device.lastSeenAt).toLocaleString()}`:'No heartbeat reported'}</span></div>
          <div className="sp-gh-device-actions"><button className="sp-button secondary" disabled={!serviceConfigured||device.deviceStatus==='disabled'||busy!==''} onClick={()=>issueCommand(device,'status_check')}>{busy===`${device.id}:status_check`?<LoaderCircle size={14} className="sp-spin"/>:<Activity size={14}/>}Status check</button><button className="sp-button secondary" disabled={!serviceConfigured||!device.supportsEntry||device.deviceStatus!=='online'||busy!==''} onClick={()=>issueCommand(device,'open')}><DoorOpen size={14}/>Queue open</button><button className="sp-button secondary" disabled={!serviceConfigured||!device.supportsExit||device.deviceStatus!=='online'||busy!==''} onClick={()=>issueCommand(device,'close')}><DoorClosed size={14}/>Queue close</button></div>
        </div>)}{!devices.length&&<div className="sp-gh-empty">{loading?'Loading devices…':'No gate devices registered for your facilities yet.'}</div>}</div>
      </article>
      <article className="sp-panel sp-gh-panel"><div className="sp-panel-header"><div><p className="sp-kicker">INTEGRATION SETUP</p><h2>Register a controller</h2><p>Enter the adapter/provider identifier—not a camera RTSP URL.</p></div><Plus size={19}/></div>
        <form className="sp-form" onSubmit={createDevice}>
          <label>Facility<select value={form.parkingLotId} onChange={e=>setForm({...form,parkingLotId:e.target.value})} required><option value="">Choose a managed facility</option>{lots.map(lot=><option value={lot.id} key={lot.id}>{lot.name} · {lot.city}</option>)}</select></label>
          <label>Device name<input value={form.deviceName} onChange={e=>setForm({...form,deviceName:e.target.value})} minLength={2} maxLength={120} placeholder="Main entrance barrier" required/></label>
          <label>Hardware provider / adapter<input value={form.provider} onChange={e=>setForm({...form,provider:e.target.value})} minLength={2} maxLength={80} placeholder="generic-http-adapter" required/></label>
          <label>External device ID (optional)<input value={form.externalDeviceId} onChange={e=>setForm({...form,externalDeviceId:e.target.value})} maxLength={180} placeholder="Controller ID from provider"/></label>
          <label className="sp-gh-checkbox"><input type="checkbox" checked={form.supportsEntry} onChange={e=>setForm({...form,supportsEntry:e.target.checked})}/> Supports entry/open commands</label>
          <label className="sp-gh-checkbox"><input type="checkbox" checked={form.supportsExit} onChange={e=>setForm({...form,supportsExit:e.target.checked})}/> Supports exit/close commands</label>
          <button className="sp-button primary" disabled={busy!==''||!form.parkingLotId}><Plus size={15}/>{busy==='create'?'Registering…':'Register device'}</button>
          {!lots.length&&<p className="sp-form-hint">No managed facilities found. Create or get access to a facility first.</p>}
        </form>
      </article>
    </div>
    <article className="sp-panel sp-gh-panel"><div className="sp-panel-header"><div><p className="sp-kicker">COMMAND AUDIT</p><h2>Recent commands</h2><p>Queued commands expire in 60 seconds if no adapter claims them.</p></div></div><div className="sp-table-wrap"><table className="sp-table"><thead><tr><th>Device</th><th>Facility</th><th>Command</th><th>Status</th><th>Requested</th><th>Expires</th></tr></thead><tbody>{commands.map(command=><tr key={command.id}><td>{command.deviceName}</td><td>{command.parkingLotName}</td><td>{command.commandType}</td><td><span className={`status-pill ${command.status}`}>{command.status}</span></td><td>{new Date(command.createdAt).toLocaleString()}</td><td>{new Date(command.expiresAt).toLocaleTimeString()}</td></tr>)}{!commands.length&&<tr><td colSpan="6">No gate commands recorded yet.</td></tr>}</tbody></table></div></article>
    <p className="sp-gh-security-note"><ShieldCheck size={16}/> Every command requires an authenticated user, facility access, a reason, and server-side expiry. The edge adapter must use the separate service token and must validate safety conditions locally before controlling the physical barrier.</p>
  </section>;
}
