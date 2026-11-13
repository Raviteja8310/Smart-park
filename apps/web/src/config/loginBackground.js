/**
 * Sign-in screen background — change it here.
 *
 *   'video'     → the looping video below (public/videos/login-background.mp4)
 *   'animation' → the original animated underground-garage illustration
 *                 (public/assets/backgrounds/login/underground-garage.svg), kept unchanged
 *
 * To use a different video later, replace public/videos/login-background.mp4 (and the
 * poster image) with files of the same name, or point the paths below at new files.
 */
export const LOGIN_BACKGROUND = 'video';

export const LOGIN_VIDEO = {
  src: '/videos/login-background.mp4',
  // First frame of the video: shown while it loads, if it fails, and when motion is reduced.
  poster: '/assets/backgrounds/login/login-video-poster.jpg',
  // Which part of the frame stays in view when the panel crops the video (the cars sit just below centre).
  focus: 'center 58%',
  // Tint the SMARTPARK wordmark to match the video's lighting (false = the fixed brand colours).
  adaptiveBrandColour: true
};
