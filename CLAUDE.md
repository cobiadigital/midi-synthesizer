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
note stack, legato and glide. Each voice mixes two oscillators, a sub and
noise into its own ladder filter and filter envelope; the voices sum to mono
and a stereo effects bus (high-pass, ping-pong delay, reverb) is what makes the
output stereo. A Logic Pro Audio Unit is still out of scope.

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
params use `step` and `choices`, and `control` names the widget: `switch` for
two states, `select` for a short list of names, `stepper` for a small count,
knob for everything else. A stepped param with many positions (octave, clock
division) stays a knob, because sweeping through it is the point.

The array order is the panel order, and `PARAM_INDEX` is derived from it with
nothing persisting an index, so a control moves by moving its entry. The CC map
stores param ids, not positions.

`paramToNorm`, `paramFromNorm` and `snapParam` in the same file are the taper
maths, and both the knob element and MIDI CC mapping go through them. A
controller's travel therefore matches what the knob does under a finger,
including the log tapers, and there is one place to change if a taper changes.

### Panel

`src/ui/panel.ts` builds the whole panel from `PARAMS`, one section per
`group`, in the order the registry lists them, which is the order the signal
flows: voice allocation, oscillators, mixer, filter, filter envelope, amp
envelope, modulation, arpeggiator, the two effects, and the output stage. No
layout is written out by hand anywhere.

`OUTPUT` is the one group that is not simply "the params of one module": it
holds the master high-pass and both effect send levels, because the effects are
sends rather than crossfades and the send is the control you reach for. Leaving
each mix in its own section meant folding DELAY away also folded away the only
control that turns the delay up.

`ControlElement` in `src/ui/control.ts` is what the widgets share: value
snapping, the `change` and `learn` events, the armed state and the CC label.
`CcMap` binds by `ParamId` rather than by widget, so a switch has to be
learnable and honour soft takeover exactly as a knob does; that contract lives
in one place rather than four. Soft takeover needs a visual per widget: the
knob has a tick on its rim, a switch or stepper a dot beside the label, and a
select marks the option the dial is pointing at.

Sections fold on a tap and what is folded lives in localStorage under
`midi-panel-collapsed`; first run on a narrow screen opens only enough to make
a sound, a wide screen opens everything. Nothing but the title row is pinned:
a strip of volume, tempo and arp was tried and taken out again, because none of
the three is touched often enough to be worth the permanent height on a phone,
and the panel binds one control per `ParamId`, so pinning the controls that are
(cutoff, the mod wheel) would take them out of their own sections.

`VISIBLE_WHEN` hides controls that are genuinely inert: a synced LFO has no
free rate, a poly voice never glides. Anything merely unused stays on the
panel, because hiding on a value change moves the rest of a section under a
finger mid-edit. `GROUP_ACTIVE` lights a dot on a heading whose section is
doing something, which is the only way to tell with it folded.

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

### Modulation

`Lfo` in `src/dsp/lfo.ts` is a modulation source, not something you hear, so
nothing in it is band-limited and nothing needs to be: a PolyBLEP square exists
to stop a 2 kHz edge folding back into the audible range, and a 5 Hz square's
edges land where nothing is listening. `random` is sample and hold, one value
per cycle held flat, seeded per instance so a pool does not step through the
same sequence together. It can run free in Hz or follow the step clock, using
the same arithmetic as `StepClock`.

Every voice owns one, retriggered on note-on, so a chord shimmers rather than
pulsing in lockstep. One destination at a time, chosen by `lfoTarget`:

- **cutoff** joins the existing per-sample cutoff sum as another term in
  semitones, which is why routing it there costs almost nothing: the
  exponential it needs was already being computed at `CONTROL_INTERVAL`.
- **pitch** is a ratio applied to every oscillator, recomputed at the same
  control rate for the same reason.
- **shape** is added to both oscillators' shape and clamped, per sample, since
  it needs no exponential at all.

The mod wheel is a param (`modWheel`), bound to CC 1 by default, so it also
appears on the panel for anyone playing without one. It **adds** to the depth
knob rather than scaling it, so a patch with the LFO parked still comes alive
when the wheel goes up. It is exempt from CC soft takeover: a pot's position is
invisible until it moves, but a wheel rests at zero where the player can see
it, so making it earn takeover would just make it feel dead.

Velocity reaches two places, both as amounts: `velToAmp` for loudness and
`velToCutoff` for brightness. The cutoff share is a per-block constant, since
velocity cannot change under a held note.

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

`Voice` in `src/dsp/voice.ts` is one sounding note, wired mixer into ladder
filter into amp envelope: the order every subtractive synth uses. It also owns
the filter envelope, a glide smoother and a velocity gain.

The mixer feeds VCO 1, VCO 2, a square sub an octave below VCO 1, and white
noise. VCO 2's octave, coarse semitones and fine cents collapse into a single
ratio against VCO 1, worked out once per block, so a second oscillator costs a
multiply per sample rather than another `midiToHz`, and it tracks the keyboard
and glide for free. The sub is derived the same way, at half VCO 1's frequency,
so it follows VCO 1's octave switch rather than sitting at a fixed pitch.

A source whose mixer level is zero is not rendered: the default patch is VCO 1
alone and costs what it did before the mixer existed. A silent oscillator's
phase stops where it is, which is not a discontinuity when it comes back — the
step in level is, and that is there either way, since mixer levels are not
smoothed.

Noise is seeded per voice (`Voice`'s third constructor argument, supplied by
the pool as the slot index). Eight voices sharing a stream would be one noise
source at eight times the level rather than eight of them, which sums 6 dB hot
and sounds like a single hiss rather than a chord.

Glide is a one-pole smoother on the MIDI note number, applied per sample.
Velocity is kept as 0..1 and turned into gain per block, so `velToAmp` can move
under a held note; its default of 0.7 is exactly the fixed 30-to-100% curve the
voice had before that knob existed. `add()` mixes into the buffer rather than
replacing it, so engines can be summed; an idle voice returns early and snaps
its gain smoother to target, which keeps output identical no matter how the
render is chunked.

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

Worst case measured offline is about 17% of one x86 core per second of audio:
eight voices sounding, all four mixer sources up, both oscillators shaped, the
cutoff modulated, the LFO running, and delay, reverb and high-pass all on. The
same eight voices on the default patch, VCO 1 alone, are about 8.7%, which is
what the skip-when-zero above buys. Of the difference, shaping is the
expensive part at roughly 3 points: a shaped saw computes a second PolyBLEP
every sample. The LFO costs about 0.3 of a point, because routing it to the
cutoff reuses an exponential that was already being computed. A phone has
room but not a lot of it. Idle voices cost a branch. If that budget gets
tight, the per-sample work in `Voice.add()` is where to look first.

### Oscillator

PolyBLEP anti-aliasing. Triangle is a leaky integral of the square. What
`shape` does depends on the wave:

- **square**: pulse width, 50% to 95%.
- **saw**: a second saw subtracted at a phase offset. The difference of two
  saws is silent at every harmonic whose wavelength divides the offset evenly,
  so sweeping shape sweeps a comb through the spectrum; at a half-cycle offset
  the even harmonics vanish and what is left is hollow and nasal. The second
  copy carries its own PolyBLEP, because it brings a second discontinuity per
  cycle and an uncorrected one would alias.
- **triangle**: wave folding. `fold()` reflects the signal back into range
  rather than clipping at it, so the peaks turn around and head down again.
  It is continuous and bounded, and periodic in 4 so any overshoot folds.

At shape 0 every wave is bit-for-bit what it was before shaping existed, which
there is a test for. The folder's corners are not band-limited and will alias
if pushed hard; folding a triangle is gentle because there is little harmonic
content to begin with, but folding a saw would not be, which is one reason
shape means something different on each wave.

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
- No UI framework. Controls are custom elements with shadow DOM
  (`<synth-knob>`, `<synth-switch>`, `<synth-select>`, `<synth-stepper>`), all
  extending `ControlElement`. Document styles do not reach inside a shadow
  root, so the panel's gesture defences are restated in `CONTROL_STYLES`.
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
2. **Done.** Four-pole ladder low-pass, oversampled 2x, with cutoff, resonance,
   drive, key tracking and envelope amount, a dedicated filter envelope, and a
   two-pole high-pass on the master. Second VCO with its own wave, shape,
   octave, coarse pitch and fine detune; square sub an octave down; white
   noise; four-channel mixer.
3. **Mostly done**: LFO with rate, wave, tempo sync and a target switch
   (cutoff, pitch, shape), per voice and note-retriggered; saw shape and
   triangle fold; mod wheel on CC 1 and velocity routed to loudness and
   cutoff. Still to do: oscillator sync, ring mod, cross mod.
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
   reverb, and an LFO that syncs to the same clock. Still to do: chorus.

## Known browser constraints

- Audio cannot start without a user gesture. `AudioEngine.start()` is only
  called from the Start button.
- Web MIDI works in Chrome and Edge. Safari support is unreliable; the
  computer keyboard and on-screen keys are the fallback.
- AudioWorklet and Web MIDI both need a secure context (HTTPS or localhost).
