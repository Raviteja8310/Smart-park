import { useCallback, useEffect, useState } from 'react';
import { Bell, BellRing, Check, CheckCheck, Mail, RefreshCw } from 'lucide-react';

async function apiRequest(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? 'The request could not be completed.');
  return data;
}
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const query = new URLSearchParams({ limit: '100', unreadOnly: String(unreadOnly) });
      const data = await apiRequest(`/api/notifications/mine?${query}`);
      setNotifications(data.notifications ?? []); setUnreadCount(Number(data.unreadCount || 0));
    } catch (requestError) { setError(requestError.message || 'Notifications are not available.'); }
    finally { setLoading(false); }
  }, [unreadOnly]);
  useEffect(() => { load(); }, [load]);

  async function markRead(notification) {
    if (notification.delivery_status === 'read') return;
    setBusyId(notification.id); setError(''); setNotice('');
    try { await apiRequest(`/api/notifications/${notification.id}/read`, { method: 'POST' }); setNotice('Notification marked as read.'); await load(); }
    catch (requestError) { setError(requestError.message || 'Unable to mark as read.'); }
    finally { setBusyId(''); }
  }
  async function markAllRead() {
    setBusyId('all'); setError(''); setNotice('');
    try { await apiRequest('/api/notifications/read-all', { method: 'POST' }); setNotice('All notifications marked as read.'); await load(); }
    catch (requestError) { setError(requestError.message || 'Unable to update notifications.'); }
    finally { setBusyId(''); }
  }

  return <section className="sp-notifications-page">
    <div className="sp-ops-title-row"><div><p className="section-kicker">YOUR INBOX</p><h1>Notifications</h1><p className="muted-copy">Booking, payment, gate and operational updates recorded for your account.</p></div><div className="sp-notification-toolbar"><button className="sp-button secondary" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button><button className="sp-button primary" onClick={markAllRead} disabled={loading || unreadCount === 0 || busyId === 'all'}><CheckCheck size={15} /> Mark all read</button></div></div>
    {error && <div className="sp-ops-message error">{error}</div>}{notice && <div className="sp-ops-message success">{notice}</div>}
    <div className="sp-notification-summary"><div className="sp-notification-summary-icon"><BellRing size={21} /></div><div><strong>{unreadCount} unread notification{unreadCount === 1 ? '' : 's'}</strong><p>Notifications in this inbox are private to your signed-in account.</p></div><label><input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} /> Unread only</label></div>
    <div className="sp-notification-list">{notifications.map((item) => <article key={item.id} className={`sp-notification-card ${item.delivery_status === 'read' ? 'read' : 'unread'}`}>
      <span className="sp-notification-icon">{item.delivery_status === 'read' ? <Mail size={18} /> : <Bell size={18} />}</span>
      <div className="sp-notification-content"><div className="sp-notification-title-row"><strong>{item.title}</strong><span className={`sp-notification-delivery ${item.delivery_status}`}>{item.delivery_status.replaceAll('_', ' ')}</span></div><p>{item.message}</p><small>{formatDate(item.created_at)} · {item.channel.replaceAll('_', ' ')} · {item.event_type}</small></div>
      {item.delivery_status !== 'read' && <button className="sp-button ghost" onClick={() => markRead(item)} disabled={busyId === item.id}><Check size={14} /> Mark read</button>}
    </article>)}
    {!notifications.length && <div className="sp-ops-empty"><Bell size={24} /><strong>{loading ? 'Loading your inbox…' : 'You’re all caught up'}</strong><span>{loading ? 'Reading notifications for your account.' : 'Important booking and operational updates will appear here.'}</span></div>}</div>
  </section>;
}
