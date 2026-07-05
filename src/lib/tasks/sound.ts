// Short synthesized chime for new task notifications — no binary asset,
// just two quick oscillator tones. Browsers suspend AudioContext until a
// user gesture; primeNotificationSound() should be called from an early
// pointerdown/click handler so playback isn't silently dropped later.
let sharedContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedContext) sharedContext = new Ctor();
  return sharedContext;
}

export function primeNotificationSound(): void {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
}

function playTone(ctx: AudioContext, frequency: number, startTime: number, duration: number) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.18, startTime + 0.015);
  gain.gain.linearRampToValueAtTime(0, startTime + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
}

export function playNotificationChime(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  if (ctx.state === "closed") return;
  const now = ctx.currentTime;
  // Three-note ascending arpeggio (G5-B5-D6), triangle wave — softer and
  // more distinct from the old two-tone sine sweep.
  playTone(ctx, 784, now, 0.08);
  playTone(ctx, 988, now + 0.08, 0.08);
  playTone(ctx, 1175, now + 0.16, 0.14);
}
