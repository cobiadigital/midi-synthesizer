# CLAUDE.md

Context for AI-assisted work on this repository. Read this before changing
anything. Keep it current when architecture, conventions, or roadmap change.
Human-facing setup and usage live in README.md.

## What this is

A browser-based monophonic subtractive synthesizer with MIDI input, written
in TypeScript, deployed as a static PWA on Cloudflare Workers. The sonic
target is a hybrid: Korg Minilogue panel and features (two VCOs with wave,
shape, octave, pitch, sync, ring mod, cross mod, mixer with noise, two
envelopes, LFO with targets) feeding a Moog four-pole ladder filter with
drive. Mono only for now. Polyphony and a Logic Pro Audio Unit are explicitly
out of scope until the mono engine sounds right.

## Architecture

Three layers, strictly separated:

1. **DSP core** in `src/dsp/`. Plain TypeScript classes with a per-sample
   `process()` or per-block `render()` method. No DOM, no Web Audio, no
   imports outside `src/dsp/`. This is what the tests exercise.
2. **Audio thread** in `src/worklet/synth-processor.ts`. One
   `AudioWorkletProcessor` that owns a `MonoVoice` and applies messages from
   the main thread. It is loaded via Vite's `?worker&url` import so its
   imports get bundled.
3. **Main thread** in `src/main.ts`, `src/audio-engine.ts`, `src/midi/`,
   `src/ui/`. Talks to the worklet only through `SynthMessage` objects posted
   over the MessagePort. Never touches audio state directly.

### Parameters

`src/dsp/params.ts` is the single source of truth. Every user-facing control
is a `ParamDef` in the `PARAMS` array. The UI builds knobs from it, the
worklet stores values in a `ParamStore` indexed by it, and presets are
`Record<ParamId, number>`. To add a control:

1. Add the `ParamId` to the union and a `ParamDef` to `PARAMS`.
2. Read it in `MonoVoice.render()` (per-block params) or handle it in
   `MonoVoice.applyParam()` (params that configure a sub-module).
3. Add a test if it changes the sound in a measurable way.

Time and frequency params use `taper: "log"` so knobs feel right. Discrete
params use `step` and `choices`.

### Voice

`MonoVoice` holds a note stack for last-note priority. Releasing the newest
key while an older key is held slides back to the older note without
retriggering the envelope (legato). Glide is a one-pole smoother on the MIDI
note number, applied per sample. Velocity scales gain between 30% and 100%.

### Oscillator

PolyBLEP anti-aliasing. Triangle is a leaky integral of the square. `shape`
currently only affects square (pulse width). Saw shape and triangle folding
are reserved for milestone 3.

### Envelope

Exponential ADSR using overshoot targets so stages actually complete. The
attack coefficient is scaled by `ln(1.3 / 0.3)` because it stops at 1.0 while
aiming at 1.3. Retrigger does not reset level, which keeps legato click-free.

## Conventions

- TypeScript strict mode with `noUncheckedIndexedAccess`. Array reads return
  `T | undefined`; use `?? 0` in DSP hot loops rather than non-null
  assertions.
- DSP classes take `sampleRate` in the constructor. Never read a global.
- Per-sample loops avoid allocation. Compute coefficients when a param
  changes, not inside `render()`.
- Comments explain the DSP reasoning (why a constant, what a term corrects),
  not what the code does.
- Tests render audio offline with `test/helpers.ts` and assert on RMS, peak,
  estimated frequency, or DFT magnitude at a harmonic. A new DSP module needs
  a test that would fail if its math were wrong.
- No UI framework. Controls are custom elements with shadow DOM.
- Python is allowed only under `tools/` for offline analysis, with a `.env`
  file for any configuration. It is never part of the runtime.

## Commands

```bash
npm run dev        # dev server
npm test           # vitest, must pass before committing
npm run build      # tsc --noEmit then vite build
npx wrangler deploy
```

## Roadmap

1. **Done.** Scaffold, one oscillator, amp envelope, MIDI in, keyboard UI.
2. Second VCO with pitch and detune, sub oscillator, noise, mixer. Moog
   ladder filter (Huovilainen model, oversampled 2x) with cutoff, resonance,
   drive, key tracking, and envelope amount. Filter envelope.
3. LFO with rate, wave, and target (pitch, shape, cutoff). Oscillator sync,
   ring mod, cross mod. Saw shape and triangle fold. Mod wheel and velocity
   routing.
4. Preset save and load (JSON in localStorage, factory bank in
   `src/presets/`). MIDI CC learn. PWA service worker for offline use.
5. Arpeggiator (MIDI event transformer ahead of the voice), delay and chorus
   on a post-voice effects bus, first Workers deploy.

## Known browser constraints

- Audio cannot start without a user gesture. `AudioEngine.start()` is only
  called from the Start button.
- Web MIDI works in Chrome and Edge. Safari support is unreliable; the
  computer keyboard and on-screen keys are the fallback.
- AudioWorklet and Web MIDI both need a secure context (HTTPS or localhost).
