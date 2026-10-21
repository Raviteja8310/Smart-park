import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Clock3, Heart, LoaderCircle, MapPin, MessageSquareText, RotateCw, Search, Star, Trash2 } from 'lucide-react';
import './engagement.css';

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers ?? {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? 'The request could not be completed.');
  return data;
}

function money(value, currency = 'INR') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'Rate not set';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value));
}
function dateLabel(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}
function Stars({ value = 0 }) {
  const rounded = Math.round(Number(value) || 0);
  return <span className="sp-eng-stars" aria-label={`${Number(value || 0).toFixed(1)} out of 5 stars`}>{[1, 2, 3, 4, 5].map((star) => <Star key={star} size={13} fill={star <= rounded ? 'currentColor' : 'none'} />)}</span>;
}

export default function EngagementPage({ currentUser, initialTab = 'favorites', onUseSearch, onBrowseParking }) {
  const [tab, setTab] = useState(initialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [favorites, setFavorites] = useState([]);
  const [searches, setSearches] = useState([]);
  const [eligibleBookings, setEligibleBookings] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [reviewForms, setReviewForms] = useState({});
  const [busyKey, setBusyKey] = useState('');
  const isAdmin = (currentUser?.roles ?? []).includes('admin');
  const [moderationReviews, setModerationReviews] = useState([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [favoriteData, searchData, eligibleData, reviewData, moderationData] = await Promise.all([
        apiRequest('/api/engagement/favorites'),
        apiRequest('/api/engagement/search-history?limit=30'),
        apiRequest('/api/engagement/eligible-reviews'),
        apiRequest('/api/engagement/my-reviews?limit=50'),
        isAdmin ? apiRequest('/api/engagement/reviews/moderation-queue?limit=50') : Promise.resolve({ reviews: [] })
      ]);
      setFavorites(favoriteData.favorites ?? []);
      setSearches(searchData.searches ?? []);
      setEligibleBookings(eligibleData.bookings ?? []);
      setReviews(reviewData.reviews ?? []);
      setModerationReviews(moderationData.reviews ?? []);
    } catch (requestError) {
      setError(requestError.message || 'Unable to load your saved parking information.');
    } finally { setLoading(false); }
  }, [isAdmin]);

  useEffect(() => { refresh(); }, [refresh, currentUser?.id]);
  useEffect(() => { setTab(initialTab === 'reviews' && !isAdmin ? 'reviews' : (initialTab ?? 'favorites')); }, [initialTab, isAdmin]);

  async function removeFavorite(lotId) {
    setBusyKey(lotId); setError(''); setNotice('');
    try {
      await apiRequest(`/api/engagement/favorites/${lotId}`, { method: 'DELETE' });
      setFavorites((current) => current.filter((item) => item.id !== lotId));
      setNotice('Parking location removed from saved places.');
    } catch (requestError) { setError(requestError.message); }
    finally { setBusyKey(''); }
  }

  async function removeSearch(searchId) {
    setBusyKey(searchId); setError(''); setNotice('');
    try {
      await apiRequest(`/api/engagement/search-history/${searchId}`, { method: 'DELETE' });
      setSearches((current) => current.filter((item) => item.id !== searchId));
      setNotice('Recent search removed.');
    } catch (requestError) { setError(requestError.message); }
    finally { setBusyKey(''); }
  }

  async function clearSearches() {
    setBusyKey('clear-searches'); setError(''); setNotice('');
    try {
      await apiRequest('/api/engagement/search-history', { method: 'DELETE' });
      setSearches([]); setNotice('Recent search history cleared.');
    } catch (requestError) { setError(requestError.message); }
    finally { setBusyKey(''); }
  }

  async function submitReview(event, booking) {
    event.preventDefault();
    const form = reviewForms[booking.bookingId] ?? { rating: '5', title: '', text: '' };
    setBusyKey(booking.bookingId); setError(''); setNotice('');
    try {
      await apiRequest(`/api/engagement/lots/${booking.parkingLotId}/reviews`, {
        method: 'POST', body: JSON.stringify({ bookingId: booking.bookingId, rating: Number(form.rating), title: form.title, text: form.text })
      });
      setNotice(`Thanks for reviewing ${booking.parkingLotName}.`);
      setReviewForms((current) => { const next = { ...current }; delete next[booking.bookingId]; return next; });
      await refresh();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusyKey(''); }
  }

  async function deleteReview(reviewId) {
    setBusyKey(reviewId); setError(''); setNotice('');
    try {
      await apiRequest(`/api/engagement/reviews/${reviewId}`, { method: 'DELETE' });
      setReviews((current) => current.filter((item) => item.id !== reviewId));
      setNotice('Review deleted.');
      await refresh();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusyKey(''); }
  }

  async function moderateReview(review, status) {
    setBusyKey(review.id); setError(''); setNotice('');
    try {
      await apiRequest(`/api/engagement/reviews/${review.id}/moderation`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setNotice(`Review ${status === 'hidden' ? 'hidden' : 'published'} successfully.`);
      await refresh();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusyKey(''); }
  }

  const tabs = [
    { id: 'favorites', label: 'Saved spaces', icon: Heart, count: favorites.length },
    { id: 'reviews', label: 'Reviews', icon: MessageSquareText, count: eligibleBookings.length },
    { id: 'searches', label: 'Recent searches', icon: Clock3, count: searches.length },
    ...(isAdmin ? [{ id: 'moderation', label: 'Moderation', icon: MessageSquareText, count: moderationReviews.filter((review) => review.status === 'published').length }] : [])
  ];

  return <section className="sp-engagement-page">
    <div className="sp-eng-header">
      <div><p className="sp-kicker">YOUR PARKING PREFERENCES</p><h1>Saved &amp; reviews</h1><p>Keep favourite parking spots, review completed visits and return to recent searches.</p></div>
      <button className="sp-button primary" onClick={onBrowseParking}><Search size={15} /> Find parking</button>
    </div>
    {error && <div className="sp-alert error" role="alert">{error}</div>}
    {notice && <div className="sp-alert success" role="status">{notice}</div>}
    <div className="sp-eng-tabs" role="tablist" aria-label="Saved parking sections">
      {tabs.map(({ id, label, icon: Icon, count }) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={15} /><span>{label}</span><b>{count}</b></button>)}
    </div>
    {loading ? <div className="sp-eng-loading"><LoaderCircle size={20} className="sp-eng-spin" /> Loading your parking preferences…</div> : <>
      {tab === 'favorites' && <>
        {favorites.length ? <div className="sp-eng-favorites">{favorites.map((lot) => <article className="sp-eng-favorite-card" key={lot.id}>
          <div className="sp-eng-favorite-image">{lot.coverPhoto ? <img src={lot.coverPhoto} alt={`${lot.name} parking`} /> : <MapPin size={24} />}</div>
          <div className="sp-eng-favorite-copy"><h3>{lot.name}</h3><p>{[lot.addressLine, lot.city, lot.region].filter(Boolean).join(', ')}</p><div className="sp-eng-meta"><span>{lot.averageRating === null ? 'No reviews yet' : <><Stars value={lot.averageRating} /> {lot.averageRating.toFixed(1)} ({lot.reviewCount})</>}</span><strong>{money(lot.hourlyRate, lot.currency)}<small>/hr</small></strong></div>
            <div className="sp-eng-actions">{lot.latitude !== null && lot.longitude !== null && <a className="sp-button secondary" href={`https://www.google.com/maps/dir/?api=1&destination=${lot.latitude},${lot.longitude}`} target="_blank" rel="noreferrer">Directions <ArrowUpRight size={14} /></a>}<button className="sp-button ghost" disabled={busyKey === lot.id} onClick={() => removeFavorite(lot.id)}><Heart size={14} fill="currentColor" /> Remove saved</button></div>
          </div>
        </article>)}</div> : <Empty icon={Heart} title="No saved parking yet" detail="Save places from parking search to find them quickly next time." action="Explore parking" onClick={onBrowseParking} />}
      </>}
      {tab === 'reviews' && <div className="sp-eng-reviews-layout">
        <div className="sp-eng-section-title"><div><h2>Write a review</h2><p>Reviews are available only after a completed booking.</p></div><span>{eligibleBookings.length} eligible</span></div>
        {eligibleBookings.length ? eligibleBookings.map((booking) => {
          const form = reviewForms[booking.bookingId] ?? { rating: '5', title: '', text: '' };
          return <form className="sp-eng-review-form" key={booking.bookingId} onSubmit={(event) => submitReview(event, booking)}>
            <div className="sp-eng-review-booking"><div><strong>{booking.parkingLotName}</strong><small>{booking.city} · {booking.bookingCode} · {dateLabel(booking.endAt)}</small></div><span>{money(booking.amount, booking.currency)}</span></div>
            <div className="sp-eng-form-grid"><label>Rating<select value={form.rating} onChange={(event) => setReviewForms((current) => ({ ...current, [booking.bookingId]: { ...form, rating: event.target.value } }))}><option value="5">5 — Excellent</option><option value="4">4 — Very good</option><option value="3">3 — Good</option><option value="2">2 — Fair</option><option value="1">1 — Poor</option></select></label><label>Title <span>Optional</span><input maxLength={120} value={form.title} onChange={(event) => setReviewForms((current) => ({ ...current, [booking.bookingId]: { ...form, title: event.target.value } }))} placeholder="Summarize your visit" /></label></div>
            <label className="sp-eng-text-label">Your review<textarea required minLength={3} maxLength={1000} value={form.text} onChange={(event) => setReviewForms((current) => ({ ...current, [booking.bookingId]: { ...form, text: event.target.value } }))} placeholder="Was the location easy to access? Was the space as described?" rows={3} /></label>
            <div className="sp-eng-form-footer"><small>One review per completed booking. Your public display name is shortened for privacy.</small><button className="sp-button primary" disabled={busyKey === booking.bookingId}>{busyKey === booking.bookingId ? <LoaderCircle size={14} className="sp-eng-spin" /> : <MessageSquareText size={14} />} Publish review</button></div>
          </form>;
        }) : <Empty icon={MessageSquareText} title="No reviews waiting" detail="After a parking session is marked completed, you can leave a verified review here." />}
        <div className="sp-eng-section-title sp-eng-mine-title"><div><h2>Your reviews</h2><p>Reviews you have submitted.</p></div><span>{reviews.length} total</span></div>
        {reviews.length ? reviews.map((review) => <article className="sp-eng-own-review" key={review.id}><div className="sp-eng-own-review-top"><div><h3>{review.parkingLotName}</h3><Stars value={review.rating} /> {review.rating}/5</div><div className="sp-eng-review-status">{review.status}</div></div>{review.title && <strong>{review.title}</strong>}<p>{review.text}</p><div className="sp-eng-own-review-footer"><small>{review.bookingCode} · Updated {dateLabel(review.updatedAt)}</small><button className="sp-button ghost" disabled={busyKey === review.id} onClick={() => deleteReview(review.id)}><Trash2 size={14} /> Delete</button></div></article>) : <p className="sp-eng-muted">You haven't submitted a review yet.</p>}
      </div>}
      {tab === 'searches' && <>
        <div className="sp-eng-section-title"><div><h2>Recent searches</h2><p>Saved search text and city filters. Location coordinates are not stored here.</p></div>{searches.length > 0 && <button className="sp-button ghost" disabled={busyKey === 'clear-searches'} onClick={clearSearches}><Trash2 size={14} /> Clear history</button>}</div>
        {searches.length ? <div className="sp-eng-search-list">{searches.map((search) => <article key={search.id} className="sp-eng-search-row"><span className="sp-eng-search-icon"><Search size={16} /></span><div className="sp-eng-search-copy"><strong>{search.q || 'All facilities'}{search.city ? ` · ${search.city}` : ''}</strong><small>{dateLabel(search.searchedAt)}{search.resultCount === null ? '' : ` · ${search.resultCount} results`}</small></div><button className="sp-button secondary" onClick={() => onUseSearch({ q: search.q, city: search.city })}>Search again <RotateCw size={14} /></button><button className="sp-eng-icon-button" aria-label="Remove search" disabled={busyKey === search.id} onClick={() => removeSearch(search.id)}><Trash2 size={15} /></button></article>)}</div> : <Empty icon={Search} title="No recent searches" detail="Search for a parking facility or city and it will appear here." action="Find parking" onClick={onBrowseParking} />}
      </>}
      {tab === 'moderation' && isAdmin && <>
        <div className="sp-eng-section-title"><div><h2>Review moderation</h2><p>Hide reviews that violate the platform rules. Hidden reviews are excluded from public rating totals.</p></div><span>{moderationReviews.length} recent</span></div>
        {moderationReviews.length ? moderationReviews.map((review) => <article className="sp-eng-own-review" key={review.id}><div className="sp-eng-own-review-top"><div><h3>{review.parkingLotName}</h3><small className="sp-eng-moderation-meta">{review.reviewerName} · {review.bookingCode} · {dateLabel(review.createdAt)}</small><div><Stars value={review.rating} /> {review.rating}/5</div></div><div className="sp-eng-review-status">{review.status}</div></div>{review.title && <strong>{review.title}</strong>}<p>{review.text}</p><div className="sp-eng-own-review-footer"><small>Updated {dateLabel(review.updatedAt)}</small><button className={`sp-button ${review.status === 'published' ? 'ghost' : 'secondary'}`} disabled={busyKey === review.id} onClick={() => moderateReview(review, review.status === 'published' ? 'hidden' : 'published')}>{busyKey === review.id ? <LoaderCircle size={14} className="sp-eng-spin" /> : null}{review.status === 'published' ? 'Hide review' : 'Republish'}</button></div></article>) : <Empty icon={MessageSquareText} title="No reviews to moderate" detail="When customers submit verified reviews, recent reviews will appear here." />}
      </>}
    </>}
    <p className="sp-eng-footnote">Verified reviews are based on completed SmartPark reservations. Reviews and saved places can be removed from your account.</p>
  </section>;
}

function Empty({ icon: Icon, title, detail, action, onClick }) {
  return <div className="sp-eng-empty"><Icon size={28} /><strong>{title}</strong><p>{detail}</p>{action && <button className="sp-button primary" onClick={onClick}>{action}</button>}</div>;
}
