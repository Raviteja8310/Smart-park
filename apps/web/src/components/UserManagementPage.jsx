import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search, Save, Users, X } from 'lucide-react';

async function apiRequest(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? 'The request could not be completed.');
  return data;
}
function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString([], { dateStyle: 'medium' });
}

export default function UserManagementPage({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [pagination, setPagination] = useState({ total: 0, limit: 25, offset: 0 });
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState({ fullName: '', phone: '', accountStatus: 'active' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (offset = 0, search = appliedQuery) => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ q: search, limit: '25', offset: String(offset) });
      const data = await apiRequest(`/api/users?${params}`);
      setUsers(data.users ?? []); setPagination(data.pagination ?? { total: 0, limit: 25, offset });
    } catch (requestError) { setError(requestError.message || 'Unable to load user accounts.'); }
    finally { setLoading(false); }
  }, [appliedQuery]);

  useEffect(() => { load(0, appliedQuery); }, [load, appliedQuery]);

  function startEdit(user) {
    setEditingId(user.id);
    setDraft({ fullName: user.fullName, phone: user.phone ?? '', accountStatus: user.accountStatus });
    setError(''); setNotice('');
  }
  async function saveEdit(user) {
    setBusy(true); setError(''); setNotice('');
    try {
      const data = await apiRequest(`/api/users/${user.id}`, {
        method: 'PATCH', body: JSON.stringify({ fullName: draft.fullName, phone: draft.phone || null, accountStatus: draft.accountStatus })
      });
      setNotice(data.message || 'User updated.'); setEditingId(''); await load(pagination.offset, appliedQuery);
    } catch (requestError) { setError(requestError.message || 'Unable to save user changes.'); }
    finally { setBusy(false); }
  }
  function searchUsers(event) { event.preventDefault(); setAppliedQuery(query.trim()); }

  return <section className="sp-user-management">
    <div className="sp-ops-title-row"><div><p className="section-kicker">ADMINISTRATION</p><h1>User management</h1><p className="muted-copy">Find accounts, review access status, and edit basic account details. Passwords and role assignments are not exposed here.</p></div><button className="sp-button secondary" onClick={() => load(pagination.offset, appliedQuery)} disabled={loading}><RefreshCw size={15} /> Refresh</button></div>
    {error && <div className="sp-ops-message error" role="alert">{error}</div>}{notice && <div className="sp-ops-message success" role="status">{notice}</div>}
    <div className="sp-user-toolbar"><form onSubmit={searchUsers}><label className="sp-user-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email or phone" aria-label="Search users" /></label><button className="sp-button primary" type="submit">Search</button>{appliedQuery && <button className="sp-button secondary" type="button" onClick={() => { setQuery(''); setAppliedQuery(''); }}>Clear</button>}</form><span>{pagination.total} account{pagination.total === 1 ? '' : 's'}</span></div>
    <div className="panel sp-user-panel"><div className="table-wrap"><table className="sp-user-table"><thead><tr><th>USER</th><th>CONTACT</th><th>ROLES</th><th>STATUS</th><th>JOINED</th><th>ACTIONS</th></tr></thead><tbody>
      {users.map((user) => <tr key={user.id}>
        <td>{editingId === user.id ? <input className="sp-user-edit-input" aria-label="Full name" value={draft.fullName} onChange={(event) => setDraft((old) => ({ ...old, fullName: event.target.value }))} maxLength={120} /> : <><strong>{user.fullName}</strong><small className="table-subline">{user.id}</small></>}</td>
        <td><span>{user.email}</span>{editingId === user.id ? <input className="sp-user-edit-input" aria-label="Phone number" value={draft.phone} onChange={(event) => setDraft((old) => ({ ...old, phone: event.target.value }))} maxLength={30} placeholder="Phone (optional)" /> : <small className="table-subline">{user.phone || 'No phone number'}</small>}</td>
        <td><div className="sp-user-roles">{user.roles.map((role) => <span key={role}>{role}</span>)}</div></td>
        <td>{editingId === user.id ? <select className="sp-user-edit-input" aria-label="Account status" value={draft.accountStatus} onChange={(event) => setDraft((old) => ({ ...old, accountStatus: event.target.value }))}><option value="active">Active</option><option value="suspended">Suspended</option></select> : <span className={`sp-user-status ${user.accountStatus}`}>{user.accountStatus.replaceAll('_', ' ')}</span>}</td>
        <td>{dateLabel(user.createdAt)}</td>
        <td>{editingId === user.id ? <div className="sp-user-actions"><button className="sp-button primary" disabled={busy || draft.fullName.trim().length < 2} onClick={() => saveEdit(user)}><Save size={14} /> Save</button><button className="sp-button secondary" disabled={busy} onClick={() => setEditingId('')}><X size={14} /> Cancel</button></div> : <button className="sp-button secondary" onClick={() => startEdit(user)}>{currentUser?.id === user.id ? 'Edit my account' : 'Edit user'}</button>}</td>
      </tr>)}
    </tbody></table>{!users.length && <div className="sp-ops-empty"><Users size={24} /><strong>{loading ? 'Loading user accounts…' : 'No users found'}</strong><span>{loading ? 'Retrieving account records.' : 'Try a different name, email address or phone number.'}</span></div>}</div>
    <div className="sp-user-pagination"><span>Showing {users.length ? pagination.offset + 1 : 0}–{pagination.offset + users.length} of {pagination.total}</span><div><button className="sp-button secondary" disabled={loading || pagination.offset === 0} onClick={() => load(Math.max(0, pagination.offset - pagination.limit), appliedQuery)}>Previous</button><button className="sp-button secondary" disabled={loading || pagination.offset + pagination.limit >= pagination.total} onClick={() => load(pagination.offset + pagination.limit, appliedQuery)}>Next</button></div></div></div>
    <p className="sp-user-note">Suspending an account blocks its existing session on the next authenticated request. Changes are recorded in the audit log. Role changes and password resets should use their dedicated, audited workflows.</p>
  </section>;
}
