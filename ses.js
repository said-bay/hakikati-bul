/* Hakikati Bul: shared 8-bit sound kit for every game page.
   Everything is synthesized with WebAudio (no sound files):
   - ambient loops per scene (wind, rain, crowd, fire, crickets, ...)
   - one-shot effects when a story node opens (roar, coins, whistle, ...)
   - ending jingles and the small choice beeps
   A game calls SES.scene(SOUND, node, STORY[node]) from show(), where
   SOUND = {amb:{'scene:mode'|'scene'|'*': ambientName}, fx:{nodeId: effectName}}. */
(function () {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ac = null, master, ambBus, fxBus, noiseBuf, on = true;
  let want = null, cur = null, curName = null, lastNode = null, fxUntil = 0;

  function ctx() {
    if (!AC) return null;
    if (!ac) {
      try { ac = new AC(); } catch (e) { return null; }
      master = ac.createGain(); master.gain.value = on ? 1 : 0; master.connect(ac.destination);
      ambBus = ac.createGain(); ambBus.gain.value = 0.5; ambBus.connect(master);
      fxBus = ac.createGain(); fxBus.gain.value = 0.9; fxBus.connect(master);
      const len = ac.sampleRate * 2; noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended' && !document.hidden) ac.resume().catch(() => {});
    return ac;
  }
  const rnd = (a, b) => a + Math.random() * (b - a);

  /* ---------- building blocks ---------- */
  // tone with optional pitch slide and exponential decay
  function tone(type, f, t, dur, gain, dest, to, attack) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const a = attack || 0.005;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  // filtered noise burst with optional filter sweep
  function burst(t, dur, gain, dest, ftype, f, to, q, attack) {
    const s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; s.loop = true;
    fl.type = ftype || 'lowpass'; fl.frequency.setValueAtTime(f || 1000, t); fl.Q.value = q || 0.7;
    if (to) fl.frequency.exponentialRampToValueAtTime(to, t + dur);
    const a = attack || 0.005;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  // endless filtered noise, for ambient beds
  function bed(dest, ftype, f, q, gain) {
    const s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; s.loop = true; fl.type = ftype; fl.frequency.value = f; fl.Q.value = q; g.gain.value = gain;
    s.connect(fl).connect(g).connect(dest); s.start(0, Math.random() * 2);
    return { s, fl, g };
  }
  function lfo(param, rate, depth, dest) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = rate; g.gain.value = depth; o.connect(g).connect(param); o.start();
    return o;
  }

  /* ---------- ambient loops ---------- */
  // each returns {stop}; `out` fades in, timers stop when the ambient ends
  function ambient(build) {
    const out = ac.createGain(), t = ac.currentTime, nodes = [], timers = [];
    out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(1, t + 1.2); out.connect(ambBus);
    const live = { alive: true };
    const every = (min, max, fn) => {
      const step = () => { if (!live.alive) return; if (!document.hidden) fn(ac.currentTime + 0.05); timers.push(setTimeout(step, rnd(min, max) * 1000)); };
      timers.push(setTimeout(step, rnd(min, max) * 500));
    };
    build(out, nodes, every);
    return {
      stop() {
        live.alive = false; timers.forEach(clearTimeout);
        const n = ac.currentTime; out.gain.cancelScheduledValues(n); out.gain.setValueAtTime(out.gain.value, n);
        out.gain.exponentialRampToValueAtTime(0.0001, n + 0.8);
        setTimeout(() => { nodes.forEach(x => { try { x.stop(); } catch (e) {} }); out.disconnect(); }, 1000);
      }
    };
  }
  function wind(out, nodes, level, base) {
    const b = bed(out, 'bandpass', base, 0.9, 0.07 * level);
    nodes.push(b.s, lfo(b.fl.frequency, 0.13, base * 0.45), lfo(b.g.gain, 0.07, 0.025 * level));
  }
  function crickets(out, every, gain) {
    every(0.6, 1.5, t => { const f = rnd(4100, 4600); for (let i = 0; i < 3; i++) tone('sine', f, t + i * 0.06, 0.035, gain, out); });
  }
  function birds(out, every, min, max) {
    every(min, max, t => { const f = rnd(2200, 3400), n = 2 + (Math.random() * 3 | 0);
      for (let i = 0; i < n; i++) tone('sine', f * rnd(0.9, 1.1), t + i * 0.09, 0.07, 0.05, out, f * 1.45); });
  }
  function crowd(out, nodes, every, level) {
    const b = bed(out, 'bandpass', 750, 0.8, 0.22 * level); nodes.push(b.s);
    every(0.25, 0.5, t => b.g.gain.linearRampToValueAtTime(rnd(0.12, 0.3) * level, t + 0.25));
    every(0.12, 0.45, t => tone('square', rnd(180, 380), t, 0.06, 0.012 * level, out));
  }
  function crackle(out, nodes, every, level) {
    const b = bed(out, 'lowpass', 260, 0.7, 0.2 * level); nodes.push(b.s);
    every(0.04, 0.25, t => burst(t, rnd(0.015, 0.04), rnd(0.03, 0.12) * level, out, 'highpass', rnd(1500, 4000)));
  }
  function drum(out, t, soft) { tone('sine', 120, t, 0.18, soft ? 0.25 : 0.5, out, 40); }
  function tek(out, t, soft) { burst(t, 0.05, soft ? 0.08 : 0.18, out, 'highpass', 2200); }

  const AMB = {
    wind: (o, n, e) => wind(o, n, 1, 500),
    windNight: (o, n, e) => { wind(o, n, 1.2, 330); e(14, 24, t => FX.howl(t, o, 0.5)); },
    quiet: (o, n) => wind(o, n, 0.3, 320),
    rain: (o, n, e) => {
      const b = bed(o, 'highpass', 1300, 0.6, 0.1); n.push(b.s);
      e(0.05, 0.3, t => tone('sine', rnd(1800, 3200), t, 0.03, 0.025, o, 900));
      e(16, 30, t => FX.thunder(t, o, 0.5));
    },
    storm: (o, n, e) => {
      const b = bed(o, 'highpass', 1100, 0.6, 0.13); n.push(b.s); wind(o, n, 1.1, 420);
      e(8, 16, t => FX.thunder(t, o, 0.7));
    },
    crowd: (o, n, e) => crowd(o, n, e, 1),
    market: (o, n, e) => { crowd(o, n, e, 1); e(6, 12, t => FX.bell(t, o, 0.5)); },
    fest: (o, n, e) => {
      crowd(o, n, e, 0.8);
      const pat = 'K.TTK.T.'; let i = 0;
      e(0.2, 0.2, t => { const c = pat[i++ % pat.length]; if (c === 'K') drum(o, t); else if (c === 'T') tek(o, t); });
    },
    camp: (o, n, e) => { wind(o, n, 0.6, 450); e(5, 9, t => { for (let i = 0; i < 6; i++) tek(o, t + i * 0.09, true); drum(o, t + 0.6, true); }); },
    kitchen: (o, n, e) => { crackle(o, n, e, 0.7); e(0.06, 0.2, t => tone('sine', rnd(180, 480), t, 0.06, 0.04, o, rnd(500, 800))); },
    dice: (o, n, e) => { crowd(o, n, e, 0.6); e(2, 5, t => FX.dice(t, o, 0.8)); },
    fire: (o, n, e) => crackle(o, n, e, 1),
    crickets: (o, n, e) => { wind(o, n, 0.25, 400); crickets(o, e, 0.03); },
    owl: (o, n, e) => { wind(o, n, 0.35, 380); crickets(o, e, 0.02); e(7, 13, t => { tone('sine', 400, t, 0.35, 0.07, o, 380, 0.05); tone('sine', 380, t + 0.5, 0.6, 0.07, o, 330, 0.05); }); },
    birds: (o, n, e) => { wind(o, n, 0.25, 600); birds(o, e, 1.2, 4); },
    dawn: (o, n, e) => birds(o, e, 3, 6),
    water: (o, n, e) => {
      const b = bed(o, 'bandpass', 1500, 0.6, 0.16); n.push(b.s);
      e(0.08, 0.3, t => tone('sine', rnd(500, 1400), t, 0.04, 0.035, o, rnd(1500, 2000)));
    },
    garden: (o, n, e) => { const b = bed(o, 'bandpass', 1800, 0.6, 0.08); n.push(b.s); birds(o, e, 1.5, 4.5); },
    sea: (o, n, e) => { const b = bed(o, 'lowpass', 500, 0.7, 0.22); n.push(b.s, lfo(b.g.gain, 0.12, 0.18)); birds(o, e, 4, 9); },
    cave: (o, n, e) => { const b = bed(o, 'lowpass', 200, 0.7, 0.08); n.push(b.s); e(1.2, 3.5, t => tone('sine', rnd(1200, 2200), t, 0.3, 0.06, o, 700)); },
    hum: (o, n) => {
      const f = ac.createBiquadFilter(), g = ac.createGain(); f.type = 'lowpass'; f.frequency.value = 220; g.gain.value = 0.12;
      [55, 55.7].forEach(hz => { const x = ac.createOscillator(); x.type = 'sawtooth'; x.frequency.value = hz; x.connect(f); x.start(); n.push(x); });
      f.connect(g).connect(o); n.push(lfo(f.frequency, 0.1, 90)); wind(o, n, 0.3, 300);
    },
    sky: (o, n) => wind(o, n, 1, 900),
    engine: (o, n) => {
      const f = ac.createBiquadFilter(), g = ac.createGain(); f.type = 'lowpass'; f.frequency.value = 380; g.gain.value = 0.16;
      [70, 71.3].forEach(hz => { const x = ac.createOscillator(); x.type = 'sawtooth'; x.frequency.value = hz; x.connect(f); x.start(); n.push(x); });
      f.connect(g).connect(o); wind(o, n, 0.5, 900);
    },
    battle: (o, n, e) => { wind(o, n, 0.8, 380); crackle(o, n, e, 0.35); },
  };

  /* ---------- one-shot effects ---------- */
  // FX[name](t, dest, level)
  const FX = {
    roar(t, d, k = 1) {
      burst(t, 1.5, 0.5 * k, d, 'lowpass', 1400, 250, 1, 0.12);
      const o = tone('sawtooth', 150, t, 1.5, 0.22 * k, d, 60, 0.12); lfo(o.frequency, 28, 18).stop(t + 1.6);
    },
    coin(t, d, k = 1, n = 1) { for (let i = 0; i < n; i++) { tone('square', 1976, t + i * 0.09, 0.05, 0.06 * k, d); tone('square', 2637, t + i * 0.09 + 0.05, 0.14, 0.06 * k, d); } },
    coins(t, d, k = 1) { FX.coin(t, d, k, 5); },
    coinLose(t, d, k = 1) { [2637, 1976, 1318, 988, 659].forEach((f, i) => tone('square', f, t + i * 0.1, 0.09, 0.05 * k, d)); },
    whistle(t, d, k = 1) {
      [740, 932].forEach(f => tone('square', f, t, 1.0, 0.05 * k, d, f * 0.94, 0.04));
      burst(t + 0.1, 0.8, 0.12 * k, d, 'highpass', 1500);
    },
    hooves(t, d, k = 1) { [0, 0.12, 0.3, 0.42, 0.6, 0.72, 0.9, 1.02, 1.2, 1.32].forEach(x => { burst(t + x, 0.03, 0.25 * k, d, 'bandpass', 900, 0, 3); tone('sine', 300, t + x, 0.03, 0.12 * k, d); }); },
    sword(t, d, k = 1) { burst(t, 0.25, 0.25 * k, d, 'highpass', 5000, 1500); tone('sine', 2600, t + 0.05, 0.5, 0.05 * k, d); tone('sine', 3900, t + 0.05, 0.4, 0.03 * k, d); },
    laugh(t, d, k = 1) { [300, 285, 270, 255, 240].forEach((f, i) => tone('square', f, t + i * 0.14, 0.08, 0.05 * k, d, f * 0.9)); },
    run(t, d, k = 1) { for (let i = 0; i < 7; i++) burst(t + i * 0.13, 0.04, 0.3 * k, d, 'lowpass', 300); burst(t, 0.9, 0.06 * k, d, 'highpass', 800, 0, 0.7, 0.2); },
    door(t, d, k = 1) { const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 2; f.connect(d); const o = tone('sawtooth', 140, t, 0.9, 0.35 * k, f, 220, 0.1); lfo(o.frequency, 9, 30).stop(t + 1); },
    creak(t, d, k = 1) { const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 2; f.connect(d); const o = tone('sawtooth', 220, t, 0.5, 0.3 * k, f, 300, 0.05); lfo(o.frequency, 12, 25).stop(t + 0.6); },
    plates(t, d, k = 1) { [2800, 3300, 2500].forEach((f, i) => tone('triangle', f, t + i * 0.12, 0.15, 0.06 * k, d)); },
    bugle(t, d, k = 1) { [[392, .15], [523, .15], [659, .15], [784, .3], [659, .15], [784, .5]].reduce((x, [f, l]) => { tone('square', f, x, l, 0.06 * k, d, 0, 0.02); return x + l; }, t); },
    snare(t, d, k = 1) { for (let i = 0; i < 20; i++) burst(t + i * 0.04, 0.025, (0.04 + i * 0.008) * k, d, 'highpass', 1800); drum(d, t + 0.85, true); tek(d, t + 0.85, true); },
    march(t, d, k = 1) { for (let i = 0; i < 6; i++) { burst(t + i * 0.35, 0.05, 0.3 * k, d, 'lowpass', 220); tone('sine', 90, t + i * 0.35, 0.06, 0.15 * k, d); } },
    heavy(t, d, k = 1) { for (let i = 0; i < 4; i++) { const x = t + i * 0.5; burst(x, 0.07, 0.9 * k, d, 'lowpass', 180); tone('sine', 80, x, 0.09, 0.2 * k, d); tone('square', rnd(1300, 1800), x + 0.08, 0.03, 0.02 * k, d); tone('square', rnd(1300, 1800), x + 0.13, 0.03, 0.02 * k, d); } },
    light(t, d, k = 1) { for (let i = 0; i < 6; i++) burst(t + i * 0.26, 0.03, 0.5 * k, d, 'lowpass', 400); },
    whoosh(t, d, k = 1) { burst(t, 1.2, 0.3 * k, d, 'bandpass', 3000, 300, 1.2, 0.2); tone('sine', 1800, t, 1.2, 0.05 * k, d, 200, 0.1); },
    fall(t, d, k = 1) { FX.whoosh(t, d, k); drum(d, t + 1.15, true); burst(t + 1.15, 0.8, 0.2 * k, d, 'lowpass', 400); },
    threat(t, d, k = 1) { burst(t, 1.6, 0.4 * k, d, 'lowpass', 130, 0, 0.7, 0.6); tone('sine', 50, t, 1.6, 0.25 * k, d, 0, 0.6); },
    thunder(t, d, k = 1) { burst(t, 0.25, 0.5 * k, d, 'lowpass', 2500, 600); burst(t + 0.1, 2.6, 0.55 * k, d, 'lowpass', 500, 90, 0.7, 0.1); },
    dice(t, d, k = 1) { for (let i = 0; i < 5; i++) { const x = t + i * rnd(0.05, 0.11); burst(x, 0.012, 0.25 * k, d, 'highpass', 3000); tone('square', 1800, x, 0.01, 0.02 * k, d); } },
    zap(t, d, k = 1) { tone('square', 200, t, 0.35, 0.05 * k, d, 2400); tone('sine', 2400, t + 0.33, 0.25, 0.05 * k, d, 3000); burst(t, 0.6, 0.08 * k, d, 'highpass', 2000); },
    wheel(t, d, k = 1) { let x = 0, gap = 0.04; while (x < 2.6) { tone('triangle', 1600, t + x, 0.012, 0.06 * k, d); x += gap; gap *= 1.09; } FX.bell(t + x + 0.1, d, k); },
    sparkle(t, d, k = 1) { [1568, 2093, 2637, 3136, 4186].forEach((f, i) => tone('sine', f, t + i * 0.06, 0.25, 0.05 * k, d)); },
    ferman(t, d, k = 1) { [523, 659, 784].forEach(f => tone('triangle', f, t, 1.6, 0.05 * k, d, 0, 0.6)); FX.sparkle(t + 0.4, d, k); FX.sparkle(t + 0.9, d, k * 0.7); },
    good(t, d, k = 1) { tone('square', 1047, t, 0.07, 0.05 * k, d); tone('square', 1568, t + 0.07, 0.12, 0.05 * k, d); },
    bad(t, d, k = 1) { tone('square', 330, t, 0.1, 0.05 * k, d); tone('square', 220, t + 0.1, 0.18, 0.05 * k, d); },
    collapse(t, d, k = 1) { burst(t, 1.0, 0.45 * k, d, 'lowpass', 500, 120); for (let i = 0; i < 6; i++) burst(t + rnd(0.1, 0.9), 0.06, 0.25 * k, d, 'lowpass', rnd(200, 600)); },
    wings(t, d, k = 1) { for (let i = 0; i < 5; i++) burst(t + i * 0.25, 0.14, 0.45 * k, d, 'bandpass', 600, 0, 0.7, 0.07); },
    howl(t, d, k = 1) {
      const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(380, t); o.frequency.exponentialRampToValueAtTime(640, t + 0.6); o.frequency.setValueAtTime(640, t + 1.2); o.frequency.exponentialRampToValueAtTime(430, t + 2);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09 * k, t + 0.3); g.gain.setValueAtTime(0.09 * k, t + 1.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
      o.connect(g).connect(d); lfo(o.frequency, 6, 8).stop(t + 2.2); o.start(t); o.stop(t + 2.2);
    },
    snore(t, d, k = 1) { for (let i = 0; i < 2; i++) { const x = t + i * 2.3; burst(x, 1.2, 0.3 * k, d, 'lowpass', 300, 450, 2, 0.8); burst(x + 1.2, 1.0, 0.15 * k, d, 'lowpass', 260, 0, 0.7, 0.1); tone('sine', 70, x, 1.2, 0.12 * k, d, 0, 0.8); } },
    sneeze(t, d, k = 1) { burst(t, 0.5, 0.15 * k, d, 'bandpass', 900, 1600, 1.5, 0.45); burst(t + 0.6, 0.3, 0.28 * k, d, 'highpass', 1500); },
    fireBreath(t, d, k = 1) { burst(t, 1.5, 0.55 * k, d, 'lowpass', 2200, 500, 0.7, 0.1); for (let i = 0; i < 12; i++) burst(t + rnd(0, 1.4), 0.03, 0.25 * k, d, 'highpass', 3000); },
    win(t, d, k = 1) { [[523, .1], [659, .1], [784, .1], [1047, .2], [784, .1], [1047, .45]].reduce((x, [f, l]) => { tone('square', f, x, l, 0.06 * k, d); return x + l; }, t); },
    rooster(t, d, k = 1) {
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 1; f.connect(d);
      tone('square', 600, t, 0.15, 0.08 * k, f, 900); tone('square', 900, t + 0.15, 0.12, 0.08 * k, f); tone('square', 900, t + 0.27, 0.25, 0.08 * k, f, 1150); tone('square', 1150, t + 0.52, 0.45, 0.08 * k, f, 700);
    },
    bell(t, d, k = 1) { tone('triangle', 1320, t, 1.2, 0.07 * k, d); tone('sine', 2640, t, 0.8, 0.025 * k, d); },
    drop(t, d, k = 1) { tone('square', 660, t, 0.25, 0.05 * k, d, 220); },
    splash(t, d, k = 1) { burst(t, 0.5, 0.35 * k, d, 'bandpass', 1200, 500, 0.8); },
    gust(t, d, k = 1) { burst(t, 1.4, 0.3 * k, d, 'bandpass', 500, 1500, 0.8, 0.5); },
    drumroll(t, d, k = 1) { FX.snare(t, d, k); },
    whistleShort(t, d, k = 1) { const o = tone('sine', 2500, t, 0.6, 0.06 * k, d, 0, 0.02); lfo(o.frequency, 22, 180).stop(t + 0.7); },
  };

  /* ---------- jingles and beeps ---------- */
  const JINGLE = {
    good: [[523, .11], [659, .11], [784, .11], [1047, .22], [784, .11], [1047, .5]],
    other: [[440, .2], [392, .2], [330, .2], [294, .25], [262, .6]],
  };
  function jingleNow(good) {
    if (!ctx()) return;
    const t = ac.currentTime + 0.03, mel = good ? JINGLE.good : JINGLE.other;
    let x = t; mel.forEach(([f, l]) => { tone('square', f, x, l, 0.06, fxBus, 0, 0.01); x += l; });
    tone('triangle', good ? 131 : 110, t, x - t, 0.1, fxBus, 0, 0.05);
    tone('triangle', good ? 196 : 87, t + (x - t) / 2, (x - t) / 2, 0.1, fxBus, 0, 0.05);
  }

  /* ---------- public API ---------- */
  function setAmbient(name) {
    want = name || null;
    if (!ac || ac.state !== 'running') return;   // starts once audio is unlocked
    if (want === curName) return;
    if (cur) cur.stop();
    cur = null; curName = want;
    if (want && AMB[want]) cur = ambient((o, n, e) => AMB[want](o, n, e));
  }
  function unlock() {
    if (!ctx()) return;
    if (ac.state === 'running') setAmbient(want);
    else ac.resume().then(() => setAmbient(want)).catch(() => {});
  }
  ['pointerdown', 'touchend', 'keydown'].forEach(ev => window.addEventListener(ev, unlock, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (!ac) return;
    if (document.hidden) ac.suspend().catch(() => {}); else ac.resume().then(() => setAmbient(want)).catch(() => {});
  });

  window.SES = {
    setOn(v) {
      on = !!v;
      if (ac) { const n = ac.currentTime; master.gain.cancelScheduledValues(n); master.gain.setValueAtTime(on ? 1 : 0, n); }
    },
    beep(f, d = 0.08) {
      if (!on || !ctx()) return;
      tone('square', f, ac.currentTime + 0.01, d, 0.05, fxBus);
    },
    jingle(good) {
      if (!on) return;
      // let a scene effect that starts on the same node finish first
      setTimeout(() => { const wait = Math.max(0, fxUntil - performance.now()); setTimeout(() => jingleNow(good), wait); }, 30);
    },
    fx(name, k) {
      if (!on || !FX[name] || !ctx()) return;
      FX[name](ac.currentTime + 0.05, fxBus, k || 1); fxUntil = performance.now() + 1300;
    },
    scene(map, node, n) {
      if (!map) return;
      const amb = map.amb || {}, key = n.scene + ':' + (n.mode || '');
      const a = key in amb ? amb[key] : n.scene in amb ? amb[n.scene] : amb['*'];
      ctx(); setAmbient(a);
      if (node !== lastNode) { lastNode = node; const f = map.fx && map.fx[node]; if (f) [].concat(f).forEach((x, i) => setTimeout(() => SES.fx(x), i * 700)); }
    },
  };
})();
