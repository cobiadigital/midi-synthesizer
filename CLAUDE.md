# CLAUDE.md

Context for AI-assisted work on this repository. Read this before changing
anything. Keep it current when architecture, conventions, or roadmap change.
Human-facing setup and usage live in README.md.

## What this is

A browser-based subtractive synthesizer with MIDI input, written in
TypeScript, deployed as a static PWA on Cloudflare Workers. The sonic target
is a hybrid: Korg Minilogue panel and features (two VCOs with wave, shape,
octave, pitch, sync, ring mod, cross mod, mixer with noise, two envelopes,
LFO with targets) feeding a Moog four-pole ladder filter with drive.

It plays eight-voice polyphonic by default, with a mono mode that keeps the
note stack, legato and glide. Each voice runs its own ladder filter and filter
envelope; the voices sum to mono and a stereo effects bus (high-pass, ping-pong
delay, reverb) is what makes the output stereo. A Logic Pro Audio Unit is still
out of scope.

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
2. Read it in `Voice.add()` (per-block params) or handle it in
   `Voice.applyParam()` (params that configure a sub-module). A param that
   changes how notes are allocated rather than how one sounds belongs in
   `PolyVoices.applyParam()` or `Synth.setParam()`; one that belongs after the
   voices goes in `Bus.applyParam()` or is read per block in `Bus.process()`.
3. Add a test if it changes the sound in a measurable way.

Time and frequency params use `taper: "log"` so knobs feel right. Discrete
params use `step` and `choices`.

`paramToNorm`, `paramFromNorm` and `snapParam` in the same file are the taper
maths, and both the knob element and MIDI CC mapping go through them. A
controller's travel therefore matches what the knob does under a finger,
including the log tapers, and there is one place to change if a taper changes.

### Synth

`Synth` in `src/dsp/synth.ts` is the whole instrument: a `ParamStore`, a
sustain gate, an `Arpeggiator`, and both voice engines. Note events go into
the sustain gate, then the arpeggiator, never into a voice directly.

The sustain pedal deliberately sits *above* the arpeggiator: `noteOff` while
the pedal is down is remembered instead of being forwarded, and the pedal
coming up forwards the lot. That one placement gives a real pedal when playing
by hand and a momentary latch while the arpeggiator runs, in both voice modes,
without a line of pedal code in any voice.

Both engines exist at all times and both are mixed in `render()`, so switching
`voiceMode` releases what the outgoing engine held and lets its tail ring out
instead of cutting it dead. `engine` is read at call time by the arpeggiator's
sink, which is how the switch reaches a running pattern. `render()` walks the output buffer in chunks bounded
by `Arpeggiator.framesToEvent()`, so an arpeggiator step starts on an exact
sample instead of being rounded to the 128-frame render quantum. There is a
test asserting that output is identical whether rendered in one call or in
128-frame blocks; keep it passing when touching the loop.

`takeEvents()` drains the UI events (`arpNote`, `arpStep`, `arpStopped`) the
worklet posts back to the main thread, which is the only way the UI can know
what the pattern is playing. Only arpeggiator-generated notes are reported;
notes the arpeggiator passes through are already on screen.

### MIDI control

`CcMap` in `src/midi/cc-map.ts` maps control changes onto params. No DOM and no
Web MIDI in it: a lookup table with a state machine, so it tests offline.

Bindings are exclusive both ways, one dial to one param, so learning replaces
rather than stacking assignments that fight each other. CC 64 is the sustain
pedal, handled before the map is consulted and not learnable.

Takeover is soft. A pot has a position and the patch has a value, and on
connecting they disagree; a binding stays disengaged until the pot reaches or
crosses the value on screen, then tracks directly until something else moves
that param. `handle()` returns `waiting` with the pot position for a knob that
has not been picked up yet, which is what draws the marker on the knob's rim.
Anything that moves a param by another route (a knob dragged, a preset loaded)
must call `release()`, or the next twitch of a dial yanks the value back.

The map lives in `localStorage` under `midi-cc-map`, and `fromJSON` drops
bindings whose param this build no longer has, so a renamed control costs one
assignment rather than the whole map.

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

### Filter and effects

`LadderFilter` in `src/dsp/filter.ts` is the per-voice VCF: four one-pole
sections in series, fed back from the last into the first. Each pole turns the
phase 45 degrees at its own cutoff, so all four together hit 180 degrees there
and that is the frequency the loop rings at, which is why cutoff is marked at
the resonant peak and reads 12 dB down with resonance off. Loop gain reaches
unity near a feedback of 4; the knob goes to 4.4, so the top of the resonance
range self-oscillates.

Two details are load-bearing, and both were wrong at first:

- The saturator goes **in the loop, once**, not on every pole. A tanh on each
  pole's own state drives that state to `atanh` of its input, which runs away
  at full scale and swamps the resonance entirely.
- The feedback tap is a **two-point average of successive outputs**, a real
  half-sample delay. Written as a one-pole on its own state it becomes a
  lowpass in the feedback path, and the resonance never builds.

Everything runs at 2x. Cutoff modulation (key tracking and the filter
envelope) updates every `CONTROL_INTERVAL` samples from a counter that lives on
the voice, not the loop, so changing the host block size cannot move the update
points.

`Highpass` in the same file is a plain two-pole for the master bus, bypassed
entirely at its minimum so the default patch passes through untouched.

`Bus` in `src/dsp/bus.ts` is high-pass, then `PingPongDelay`, then `Reverb`.
Both effects are sends added to the dry signal, not crossfades, so the dry
level never moves and a mix of zero is the dry signal bit for bit. An effect at
zero mix is skipped and reset when it comes back, so nothing switched off
spends CPU or returns holding what it heard before. Delay time can follow the
step clock: same arithmetic as `StepClock`, so a synced delay lands on the
arpeggiator's steps.

`Reverb` in `src/dsp/reverb.ts` is Freeverb (eight damped combs into four
allpasses per channel, right side offset to decorrelate). Its wet gain is
divided by the comb bank's energy gain, `sqrt(1 - feedback^2)`, so the mix knob
means the same thing at every room size and the largest hall cannot pile up on
the output. Maximum comb feedback is held at 0.95 rather than Freeverb's 0.98:
a comb's gain for anything it is in tune with is `1/(1 - feedback)`, and there
is no limiter downstream.

### Voices

`Voice` in `src/dsp/voice.ts` is one sounding note, wired oscillator into
ladder filter into amp envelope: the order every subtractive synth uses. It
also owns the filter envelope, a glide smoother and a velocity gain. Glide is a one-pole smoother on the MIDI note
number, applied per sample. Velocity scales gain between 30% and 100%. `add()`
mixes into the buffer rather than replacing it, so engines can be summed; an
idle voice returns early and snaps its gain smoother to target, which keeps
output identical no matter how the render is chunked.

`MonoVoice` drives one `Voice` from a note stack with last-note priority.
Releasing the newest key while an older key is held slides back to the older
note without retriggering the envelope (legato).

`PolyVoices` in `src/dsp/poly-voices.ts` owns a fixed pool of `MAX_VOICES`
(from the `polyVoices` param's max), built up front so allocation on the audio
thread is a search, never a `new`. Stealing order is: the voice already
assigned that note, then the oldest idle voice, then the quietest releasing
voice, then the oldest held one. Voices above the current `polyVoices` limit
are released but still rendered, so turning the knob down fades the extra
notes instead of stranding them. Poly voices never glide: a stolen voice
sliding up from its old note is a swoop nobody asked for.

Voices are summed straight, the way a polysynth's voice cards sum into its
mixer. A big chord at a high master volume can therefore reach the output
ceiling; the Volume knob is the headroom control, and filter drive and the
effect mixes add to what it has to hold back.

Worst case measured offline (eight voices sounding, cutoff modulated, delay and
reverb and high-pass all on) is about 11% of one x86 core per second of audio,
so a phone has room but not a lot of it. Idle voices cost a branch. If that
budget gets tight, the per-sample work in `Voice.add()` is where to look first.

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
2. **Filter done**: four-pole ladder low-pass, oversampled 2x, with cutoff,
   resonance, drive, key tracking and envelope amount, a dedicated filter
   envelope, and a two-pole high-pass on the master. Still to do: second VCO
   with pitch and detune, sub oscillator, noise, mixer.
3. LFO with rate, wave, and target (pitch, shape, cutoff). Oscillator sync,
   ring mod, cross mod. Saw shape and triangle fold. Mod wheel and velocity
   routing.
4. **MIDI CC learn done**: eight dials mapped out of the box (CC 21 to 28, as
   a Launchkey Mini sends), soft takeover, and learn from the panel, saved to
   localStorage. Still to do: preset save and load (JSON in localStorage,
   factory bank in `src/presets/`), PWA service worker for offline use.
5. Polyphony **done**: eight-voice pool with note stealing, a mono/poly
   switch, sustain pedal on CC 64, and a multi-touch on-screen keyboard.
   Arpeggiator **done**: modes (up, down, up-down, down-up, as played,
   random), octave range, latch, and a sample-accurate step clock with tempo,
   division, swing, gate and ratcheting. Effects bus **done**: stereo
   ping-pong delay, tempo-syncable to the same clock, and a Freeverb-style
   reverb. Still to do: chorus, and syncing the LFO to the clock once it
   exists.

## Known browser constraints

- Audio cannot start without a user gesture. `AudioEngine.start()` is only
  called from the Start button.
- Web MIDI works in Chrome and Edge. Safari support is unreliable; the
  computer keyboard and on-screen keys are the fallback.
- AudioWorklet and Web MIDI both need a secure context (HTTPS or localhost).
