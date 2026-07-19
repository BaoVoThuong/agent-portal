// Synthesized chime for new task notifications — no binary asset,
// just a short arpeggio repeated for a clear 5 second ring. Browsers suspend AudioContext until a
// user gesture; primeNotificationSound() should be called from an early
// pointerdown/click handler so playback isn't silently dropped later.
let sharedContext: AudioContext | null = null;

const NOTIFICATION_RING_SECONDS = 5;
const RING_REPEAT_SECONDS = 0.6;
const RING_NOTES = [
  { frequency: 784, offset: 0, duration: 0.1 },
  { frequency: 988, offset: 0.09, duration: 0.1 },
  { frequency: 1175, offset: 0.18, duration: 0.18 },
] as const;

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
  // Three-note ascending arpeggio (G5-B5-D6), triangle wave, repeated so the
  // ring is noticeable even when the user is away from the tab.
  for (let ringOffset = 0; ringOffset < NOTIFICATION_RING_SECONDS; ringOffset += RING_REPEAT_SECONDS) {
    for (const note of RING_NOTES) {
      const noteStart = ringOffset + note.offset;
      if (noteStart >= NOTIFICATION_RING_SECONDS) continue;
      playTone(
        ctx,
        note.frequency,
        now + noteStart,
        Math.min(note.duration, NOTIFICATION_RING_SECONDS - noteStart)
      );
    }
  }
}
