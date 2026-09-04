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
   `AudioWorkletProcessor` that owns a `Synth` and applies messages from
   the main thread. It is loaded via Vite's `?worker&url` import so its
   imports get bundled. It posts `SynthReply` messages back on blocks where
   the arpeggiator produced events.
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

### Synth

`Synth` in `src/dsp/synth.ts` is the whole instrument: a `ParamStore`, an
`Arpeggiator`, and a `MonoVoice`. Note events go into the arpeggiator, never
into the voice directly. `render()` walks the output buffer in chunks bounded
by `Arpeggiator.framesToEvent()`, so an arpeggiator step starts on an exact
sample instead of being rounded to the 128-frame render quantum. There is a
test asserting that output is identical whether rendered in one call or in
128-frame blocks; keep it passing when touching the loop.

`takeEvents()` drains the UI events (`arpNote`, `arpStep`, `arpStopped`) the
worklet posts back to the main thread, which is the only way the UI can know
what the pattern is playing. Only arpeggiator-generated notes are reported;
notes the arpeggiator passes through are already on screen.

### Clock and arpeggiator

`StepClock` in `src/dsp/clock.ts` owns tempo, division, swing and ratcheting.
Timers are fractional and accumulate rather than being reassigned, which is
what stops a division like 1/8T from drifting flat. Swing lengthens
even-numbered steps and shortens odd ones by the same fraction, so a pair
always spans two straight steps; 1/3 gives the 2:1 ratio of triplet swing.
`DIVISIONS` is ordered slowest first so a knob sweeps long to short.

`Arpeggiator` in `src/dsp/arpeggiator.ts` is a MIDI event transformer ahead of
the voice. Off, it passes notes through. On, it swallows them, keeps its own
chord, and plays it back one note at a time. The sequence is rebuilt only when
the chord or a shaping param changes, never inside the sample loop. A fully
open gate (1.0) ties steps: the next note is pressed before the last is
released, so the voice glides instead of restarting. Latch keeps released
notes in the chord until a key goes down with nothing else held.

### Voice

`MonoVoice` holds a note stack for last-note priority. Releasing the newest
key while an older key is held slides back to the older note without
retriggering the envelope (legato). Glide is a one-pole smoother on the MIDI
note number, applied per sample. Velocity scales gain between 30% and 100%.

The chain is oscillator into filter into amplifier. Cutoff modulation is
summed in octaves before the exponential, so the filter envelope, key tracking
and velocity all move the filter by a musical interval wherever the cutoff
knob happens to sit. There are two envelopes, triggered and released together.

### Oscillator

PolyBLEP anti-aliasing. Triangle is a leaky integral of the square. `shape`
currently only affects square (pulse width). Saw shape and triangle folding
are reserved for milestone 3.

### Filter

`LadderFilter` in `src/dsp/filter.ts` is a four-pole transistor ladder,
2x oversampled, with multimode stage taps.

The poles are zero-delay-feedback one-poles and the resonance loop is solved
in closed form rather than being fed from the previous sample. That is the
whole reason the filter stays in tune: a unit delay in the feedback path is
what makes naive ladder models go flat and lose resonance as the cutoff
climbs. Solved this way the critical feedback is exactly 4 at every cutoff,
and each pole lands exactly on its -3.01 dB corner at the set frequency.
There are tests pinning both; do not swap in a delayed-feedback model without
reading them.

Two nonlinearities give the ladder its character without breaking the closed
form. The input stage saturates with enough headroom to stay clean at minimum
drive. The feedback path saturates too, which is what limits self-oscillation
to a usable level and makes resonance duck under a loud input; it enters the
solution as an instantaneous gain taken from the previous output, which is
accurate at twice the sample rate and can only ever reduce the feedback, so
it cannot destabilise the loop.

Modes come from mixing the stage outputs, the way an Oberheim Xpander derives
its modes from one ladder: an n-th order highpass is the binomial combination
of the first n+1 taps, and a bandpass is half the poles of lowpass feeding the
other half of highpass. Resonance always comes off the fourth pole, so every
mode resonates at the cutoff. Because the taps differ by whole poles, the gap
between the 12 dB and 6 dB modes is exactly one pole's response, which is what
the tuning tests measure.

Decimation is a two-tap average, a one-zero filter with its null at the base
sample rate. Not a brick wall, but the harmonics drive generates are low order
and it keeps them from folding back audibly.

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
npm run deploy     # manual wrangler deploy, rarely needed
```

## Deployment

Cloudflare Workers Builds is connected to the GitHub repo and owns deploys.
A merge to `main` runs `npm run build` then `npx wrangler deploy`; any other
branch runs `npx wrangler versions upload` and gets a preview URL. Node
version comes from `.node-version`. `.github/workflows/ci.yml` runs typecheck,
tests, and build on pull requests, because the Cloudflare build only
typechecks. Do not add a deploy step to GitHub Actions: it would duplicate
Workers Builds and need an API token this project does not otherwise want.
Setup steps for the dashboard live in README.md.

## Roadmap

1. **Done.** Scaffold, one oscillator, amp envelope, MIDI in, keyboard UI.
2. Filter **done**: zero-delay-feedback ladder with eight multimode responses,
   cutoff, resonance to self-oscillation, drive, key tracking, velocity, and
   a dedicated filter envelope with a bipolar amount. Still to do: second VCO
   with pitch and detune, sub oscillator, noise, and the mixer that feeds them
   all into the filter.
3. LFO with rate, wave, and target (pitch, shape, cutoff). Oscillator sync,
   ring mod, cross mod. Saw shape and triangle fold. Mod wheel and velocity
   routing.
4. Preset save and load (JSON in localStorage, factory bank in
   `src/presets/`). MIDI CC learn. PWA service worker for offline use.
5. Arpeggiator **done**: modes (up, down, up-down, down-up, as played,
   random), octave range, latch, and a sample-accurate step clock with tempo,
   division, swing, gate and ratcheting. Still to do: delay and chorus on a
   post-voice effects bus, and syncing the LFO and delay time to the same
   clock once they exist.

## Known browser constraints

- Audio cannot start without a user gesture. `AudioEngine.start()` is only
  called from the Start button.
- Web MIDI works in Chrome and Edge. Safari support is unreliable; the
  computer keyboard and on-screen keys are the fallback.
- AudioWorklet and Web MIDI both need a secure context (HTTPS or localhost).
