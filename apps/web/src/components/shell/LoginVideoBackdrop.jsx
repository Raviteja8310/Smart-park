import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import PageBackdrop from './PageBackdrop.jsx';
import { LOGIN_VIDEO } from '../../config/loginBackground.js';
import { startAdaptiveBrandTint } from './adaptiveBrandTint.js';

/**
 * Looping video background for the sign-in screen. Uses the same layer and overlay
 * classes as PageBackdrop, so text contrast and layout match the SVG scene exactly.
 * Falls back to the original animated SVG if the video cannot be played.
 */
export default function LoginVideoBackdrop() {
  const systemReduce = useReducedMotion();
  const videoRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const appReduce = typeof document !== 'undefined' && document.documentElement.classList.contains('sp-reduce-motion');
  const still = Boolean(systemReduce || appReduce);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    if (still) { video.pause(); return undefined; }
    const sync = () => {
      if (document.visibilityState === 'visible') video.play().catch(() => {}); // autoplay may be blocked; the poster stays
      else video.pause();
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [still]);

  // SMARTPARK wordmark follows the scene's lighting (see adaptiveBrandTint.js).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || failed || !LOGIN_VIDEO.adaptiveBrandColour) return undefined;
    const focusY = (Number.parseFloat(String(LOGIN_VIDEO.focus).split(' ')[1]) || 50) / 100;
    if (!still) return startAdaptiveBrandTint(video, { focusY });
    // Reduced motion: the video does not play, so take the colour once from the still poster.
    let stop = () => {};
    const poster = new Image();
    poster.onload = () => {
      // Measure against the video element's box, but read pixels from the poster image.
      const proxy = Object.assign(poster, { getBoundingClientRect: () => video.getBoundingClientRect(), closest: (sel) => video.closest(sel) });
      stop = startAdaptiveBrandTint(proxy, { focusY, still: true });
    };
    poster.src = LOGIN_VIDEO.poster;
    return () => { poster.onload = null; stop(); };
  }, [still, failed]);

  if (failed) return <PageBackdrop scene="login" intensity="hero" />;

  return (
    <div className="sp-backdrop sp-backdrop-hero scene-login sp-backdrop-video" aria-hidden="true">
      <video
        ref={videoRef}
        className="sp-backdrop-img"
        src={LOGIN_VIDEO.src}
        poster={LOGIN_VIDEO.poster}
        style={{ objectPosition: LOGIN_VIDEO.focus }}
        muted
        loop
        playsInline
        autoPlay={!still}
        preload={still ? 'none' : 'auto'}
        tabIndex={-1}
        onError={() => setFailed(true)}
      />
      <span className="sp-backdrop-overlay" />
    </div>
  );
}
