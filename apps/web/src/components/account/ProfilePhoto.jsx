import { useRef, useState } from 'react';
import { Camera, LoaderCircle, Trash2 } from 'lucide-react';
import './account.css';

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || 'The request could not be completed.');
  return data;
}

/**
 * Optional profile photo on My profile. Shows the photo (or the user's initials),
 * with buttons to add, change or remove it. The photo is private to the account.
 */
export default function ProfilePhoto({ initials, avatar, onChange }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function upload(file) {
    setError(''); setMessage('');
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) { setError('Choose a JPEG, PNG or WebP image.'); return; }
    if (file.size > MAX_BYTES) { setError('The photo must be 2 MB or smaller.'); return; }
    setBusy('upload');
    try {
      const body = new FormData();
      body.append('photo', file);
      const data = await readResponse(await fetch('/api/account/avatar', { method: 'PUT', credentials: 'same-origin', body }));
      onChange?.(data.avatar);
      setMessage('Profile photo updated.');
    } catch (uploadError) { setError(uploadError.message || 'Could not upload the photo.'); }
    finally { setBusy(''); if (inputRef.current) inputRef.current.value = ''; }
  }

  async function remove() {
    setError(''); setMessage(''); setBusy('remove');
    try {
      await readResponse(await fetch('/api/account/avatar', { method: 'DELETE', credentials: 'same-origin' }));
      onChange?.(null);
      setMessage('Profile photo removed.');
    } catch (removeError) { setError(removeError.message || 'Could not remove the photo.'); }
    finally { setBusy(''); }
  }

  return (
    <div className="sp-profile-photo">
      <span className={`sp-profile-avatar ${avatar?.url ? 'has-photo' : ''}`}>
        {avatar?.url ? <img src={avatar.url} alt="Your profile photo" /> : (initials || 'SP')}
        {busy === 'upload' && <span className="sp-profile-photo-busy"><LoaderCircle className="sp-spin" size={18} /></span>}
      </span>
      <div className="sp-profile-photo-actions">
        <input ref={inputRef} type="file" accept={ACCEPTED.join(',')} hidden onChange={(event) => upload(event.target.files?.[0])} />
        <button type="button" className="sp-button ghost" disabled={Boolean(busy)} onClick={() => inputRef.current?.click()}>
          <Camera size={14} /> {avatar?.url ? 'Change photo' : 'Add photo'}
        </button>
        {avatar?.url && (
          <button type="button" className="sp-button ghost" disabled={Boolean(busy)} onClick={remove}>
            <Trash2 size={14} /> {busy === 'remove' ? 'Removing…' : 'Remove'}
          </button>
        )}
        <small>Optional · JPEG, PNG or WebP, up to 2 MB. Only you can see it.</small>
        {error && <span className="sp-profile-photo-error" role="alert">{error}</span>}
        {message && <span className="sp-profile-photo-ok" role="status">{message}</span>}
      </div>
    </div>
  );
}
