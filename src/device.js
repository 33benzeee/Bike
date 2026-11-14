// Works out what we're running on so the game can pick controls and UI scale.
export function detectDevice() {
  const ua = navigator.userAgent || '';
  const touch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  const coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : touch;
  const hover = window.matchMedia ? window.matchMedia('(hover: hover)').matches : !touch;
  const iPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const mobileUA = /Android|iPhone|iPod|Mobile|Silk|Kindle/i.test(ua) || iPad;
  const shortSide = Math.min(window.screen.width, window.screen.height);
  let type;
  if (!touch || (!coarse && hover && !mobileUA)) type = 'desktop';
  else if (iPad || /Tablet|Silk|Kindle/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) || shortSide >= 600) type = 'tablet';
  else type = 'phone';
  return { type, touch, coarse, iOS: /iPhone|iPod/.test(ua) || iPad };
}

export const DEVICE_LABEL = { desktop: 'PC', tablet: 'Tablet', phone: 'Phone' };
