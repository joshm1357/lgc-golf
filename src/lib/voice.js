// The replay's voice (ov20): the phone reads each line out, using its own built-in voices (speechSynthesis).
// Free and on the phone, so it sounds like the phone; a proper broadcast voice would need a paid text-to-speech
// service (BUILD-STATUS.md, "Future"). Off until the person turns it on.
//
// Rules (Josh, 23 Oct: "the voice gets cut off"):
//   - Only one line at a time: a new line cancels the old one first, and the old line's "finished" never counts.
//   - The replay waits for a line to finish (onend) before moving on.
//   - Pause and skip stop the voice cleanly.

/** How good a voice is for us: Australian, then British, then any English; "natural"/"enhanced" ones first. */
export function voiceScore(v) {
  if (!v) return -1;
  const lang = String(v.lang || '').replace('_', '-').toLowerCase();
  if (!lang.startsWith('en')) return -1;
  const name = String(v.name || '');
  let s = lang === 'en-au' ? 300 : lang === 'en-gb' ? 200 : lang === 'en-nz' || lang === 'en-ie' ? 150 : 100;
  if (/natural|neural|enhanced|premium|siri/i.test(name)) s += 80;
  else if (/google/i.test(name)) s += 40;
  if (v.localService) s += 5;
  // Apple's joke voices and the robotic "compact" ones.
  if (/compact|novelty|whisper|bad news|bells|bubbles|cellos|jester|organ|trinoids|zarvox|albert|fred|junior|ralph|kathy|superstar|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley/i.test(name)) s -= 250;
  return s;
}

/** The best English voice on this phone (or null to use the phone's default). */
export function pickVoice(voices = []) {
  let best = null;
  let bestScore = 0;
  for (const v of voices || []) {
    const s = voiceScore(v);
    if (s > bestScore) { best = v; bestScore = s; }
  }
  return best;
}

/** Talking speed: a touch slower than normal; a little quicker on Fast. */
export const voiceRate = (speed) => (speed === 'fast' ? 1.08 : 0.92);

/** The longest we'll wait for a line to finish if the phone never says it has (some browsers drop onend). */
export const voiceTimeoutMs = (text, rate = 1) => Math.round((4000 + 95 * String(text || '').length) / Math.max(0.5, rate));

/**
 * A speaker that never talks over itself. synth: window.speechSynthesis; Utterance: SpeechSynthesisUtterance.
 * speak(text, { rate, onEnd }) — onEnd runs once, when THIS line finishes (or errors, or times out), never after a
 * newer line has started or stop() was called.
 */
export function createSpeaker(synth, Utterance, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let token = 0;
  let timer = null;
  const clear = () => { if (timer) { clearTimer(timer); timer = null; } };
  return {
    get ok() { return !!synth && !!Utterance; },
    speak(text, { rate = 1, onEnd } = {}) {
      token += 1;
      const mine = token;
      clear();
      const finish = () => { if (mine !== token) return; token += 1; clear(); onEnd?.(); };
      if (!synth || !Utterance || !String(text || '').trim()) { finish(); return; }
      try {
        synth.cancel();
        const u = new Utterance(String(text));
        const v = pickVoice(synth.getVoices?.() || []);
        if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-AU';
        u.rate = rate;
        u.pitch = 1;
        u.onend = finish;
        u.onerror = finish;
        timer = setTimer(finish, voiceTimeoutMs(text, rate));
        synth.speak(u);
      } catch { finish(); }
    },
    stop() {
      token += 1;
      clear();
      try { synth?.cancel(); } catch { /* fine */ }
    },
  };
}
