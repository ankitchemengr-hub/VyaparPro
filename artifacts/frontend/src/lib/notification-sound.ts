// A short two-tone chime synthesized via the Web Audio API — no audio file
// to fetch/host. Browsers block audio until the page has had at least one
// user interaction (click/tap/keypress); by the time a real background
// notification fires during normal app use that's almost always already
// happened, so this only silently no-ops on the rare page that's been
// sitting untouched since load.
export function playNotificationSound() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();

    const playTone = (freq: number, startTime: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + startTime;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.05);
    };

    playTone(880, 0, 0.15); // A5
    playTone(1108.73, 0.15, 0.2); // C#6

    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch {
    // Web Audio unavailable/blocked — the toast still shows visually either way.
  }
}

// Three short, harsher beeps — deliberately unlike the friendly chime above,
// so a "check this before saving" warning (e.g. a bill line priced at or
// below purchase cost) is recognisable by ear alone.
export function playWarningBeep() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.22, 0.44].forEach((start) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 660;
      const t0 = ctx.currentTime + start;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01);
      gain.gain.setValueAtTime(0.12, t0 + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.2);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1000);
  } catch {
    // Web Audio unavailable/blocked — the popup/toast still shows visually.
  }
}
