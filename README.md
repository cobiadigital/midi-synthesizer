# Poly Synth

An eight-voice subtractive synthesizer that runs in the browser, plays from a
MIDI keyboard, and is built to be deployed as a static PWA on Cloudflare
Workers. The design target is a hybrid of the Korg Minilogue's panel and
feature set with a Moog-style ladder filter.

## Status

Milestone 1 of 5, plus the arpeggiator from milestone 5. Current features:

- Two anti-aliased oscillators (saw, square, triangle) with shape control,
  the second with octave, coarse pitch and fine detune
- Square sub oscillator an octave below VCO 1, white noise, and a mixer
- ADSR amplitude envelope
- Eight-voice polyphony with note stealing, plus a mono mode with last-note
  priority, legato, and glide
- Four-pole ladder low-pass per voice: cutoff, resonance to self-oscillation,
  drive, key tracking, envelope amount, and its own filter envelope
- Two-pole high-pass on the master
- Stereo effects bus: ping-pong delay with tempo sync, and reverb
- Per-voice LFO with four waves, tempo sync, and a target switch
- Mod wheel and velocity routing
- Sustain pedal (MIDI CC 64, or the space bar)
- MIDI CC control of every knob, with soft takeover and on-panel learn
- Arpeggiator with six note orders, a four-octave range, and latch
- Sample-accurate step clock: tempo, division down to 1/32 and triplets,
  swing, gate length, and ratcheting
- Web MIDI input, on-screen keyboard, and computer-keyboard playing
- Offline-testable DSP core

Coming next: oscillator sync, ring mod and cross mod, presets, chorus.
See [CLAUDE.md](./CLAUDE.md) for the roadmap and architecture.

## Requirements

- Node.js 20 or newer
- Chrome or Edge for MIDI input. Other browsers work with the on-screen
  keyboard and computer keys.

## Setup

```bash
npm install
npm run dev
```

Open the printed URL, click **Start audio**, then play. Browsers refuse to
start audio without a click, so the button is not optional.

## Playing

| Input | How |
|---|---|
| MIDI keyboard | Plug in before or after starting. Devices are listed in the status line. |
| Computer keyboard | `A S D F G H J K` are white keys, `W E T Y U` black keys. `Z` and `X` shift octave, space is the sustain pedal. |
| On-screen keys | Click or touch. Several fingers at once play a chord, each can slide across keys for glissando, and lower on the key is louder. |
| Sustain pedal | A pedal on MIDI CC 64, or hold space. The keyboard outline lights while it is down. |

Knobs: drag up and down, hold Shift for fine control, double-click to reset,
scroll wheel for stepped changes. Anything with two states is a switch and
anything with a short list of choices is a row of buttons, so both are one tap
rather than a drag.

The panel is a stack of sections laid out the way the signal flows: how notes
are allocated, then the oscillators and mixer, the filter and its envelope, the
amp envelope, modulation, the arpeggiator, and last the effects bus. Tap a
section heading to fold it away; what is folded is remembered. A dot beside a
heading means that section is doing something, which is how you can tell with
it folded. On a phone the panel opens with VCO 1, MIXER and VCF unfolded and
the rest as a list of headings, and the keys stay pinned to the bottom of the
screen.

Only the title row is pinned: the beat lamp, MIDI learn and Start audio.
Controls that cannot do anything in the current patch are not shown: Glide is poly's business to ignore, Voices is mono's, and
a synced Rate is a Div.

## Oscillators and mixer

| Knob | What it does |
|---|---|
| VCO 1 / VCO 2 → Wave | Saw, square or triangle |
| VCO 1 / VCO 2 → Octave | Footage, 16' to 1' |
| VCO 1 / VCO 2 → Shape | Pulse width on the square. Reserved on the other two waves until milestone 3 |
| VCO 2 → Pitch | Coarse, in semitones, up or down an octave. Seven semitones is a fifth against VCO 1 |
| VCO 2 → Detune | Fine, in cents. A few cents off is what makes two oscillators beat and thicken |
| MIXER → VCO 1, VCO 2, Sub, Noise | Level of each source into the filter |

The sub is a square an octave below VCO 1 and follows its octave switch, so it
stays an octave down wherever VCO 1 is set. Noise is white, and every voice has
its own, so a chord is eight noise sources rather than one played loudly.

Levels sum straight, as a real mixer does: four sources at full is four times
one source, and Volume is where you take that back.

## LFO and modulation

| Knob | What it does |
|---|---|
| LFO → Wave | Triangle, saw, square, or random. Random is sample and hold: one value per cycle, held flat |
| LFO → Rate | 0.05 to 30 Hz when it is running free |
| LFO → Sync | Take the rate from the tempo instead of the Rate knob |
| LFO → Div | Which division to lock to when synced |
| LFO → Target | Cutoff, pitch or shape. One at a time |
| LFO → Depth | How far it moves the target. Cutoff swings four octaves at full, pitch an octave either way, so vibrato lives low on the knob |
| MOD → Mod | The mod wheel, which arrives on CC 1. It adds to Depth rather than scaling it, so a patch with the LFO parked still comes alive when you push the wheel |
| MOD → Vel Cut | How much velocity opens the filter |
| MOD → Vel Amp | How much velocity changes loudness. At zero the keyboard plays flat, at one a soft note nearly disappears |

Every voice has its own LFO and it restarts with each note, so a chord shimmers
rather than pulsing in lockstep.

The Shape knobs now do something on every wave. On a square it is pulse width.
On a saw it subtracts a second saw at an offset, notching harmonics out and
thinning the tone toward something hollow and nasal. On a triangle it folds the
wave, reflecting the peaks back down and growing harmonics a triangle does not
otherwise have.

## Filter

The filter is a four-pole ladder, one per voice, in the classic place: after
the oscillator and before the amplifier.

| Knob | What it does |
|---|---|
| VCF → Cutoff | Where the filter starts working, marked at the resonant peak the way ladder filters are. With resonance down, that point is already 12 dB along the slope |
| VCF → Reso | Emphasis at the cutoff. The top of the knob self-oscillates, so the filter sings on its own with no note playing |
| VCF → Drive | Pushes the filter's saturator. Small signals stay at the same level; loud ones compress and grow harmonics |
| VCF → Key | How much the cutoff follows the keyboard, so high notes stay as bright as low ones. Fully up tracks the pitch exactly |
| VCF → EG Int | How far the filter envelope moves the cutoff, up to six octaves either way. Negative closes the filter as the envelope opens |
| OUTPUT → HP Cut | Two-pole high-pass on the whole instrument, ahead of the effects. Fully down it is out of the circuit |
| VCF EG | A second ADSR wired only to the cutoff. Short decay with EG Int up is the classic plucked bass |

## Effects

Voices sum to mono and the effects are where the sound becomes stereo, so both
are worth hearing on headphones.

Both effects are sends rather than wet/dry blends, so how much of each you hear
is a send level, and both live in OUTPUT with the master high-pass. That means
you can fold DELAY and REVERB away and still dial the effects in: what is in
their own sections is what each one sounds like, not how much of it there is.

| Knob | What it does |
|---|---|
| DELAY → Time | 20 ms to 2 s. Turning it while repeats are ringing glides their pitch, like a tape delay |
| DELAY → Sync | Take the time from the tempo instead of the Time knob |
| DELAY → Div | Which division to sync to, from a whole note to 1/32, dotted and triplet included. Set to the same division as ARP → Rate and the delay lands on the arpeggiator's steps |
| DELAY → Feedback | How many repeats. Each crossing loses a little top end, so they darken as they go |
| OUTPUT → Delay | How much delay to add. At zero the delay is out of the circuit entirely |
| REVERB → Size | Small bright room through to a long hall. The level stays put as you turn it |
| REVERB → Damp | How fast the tail loses its high end. Up is a soft room, down is tiled |
| OUTPUT → Reverb | How much reverb to add. At zero the reverb is out of the circuit entirely |
| OUTPUT → Volume | Headroom for the whole instrument. Voices sum straight, so a big chord with the drive and both sends up is what this is holding back |

Repeats alternate between the channels: first left, then right, then back
again. Both mixes add to the dry signal rather than fading it away, so turning
them up adds level: a large room at a high mix wants Volume down.

## Voices

| Knob | What it does |
|---|---|
| VOICE → Mode | `poly` gives every note its own voice. `mono` plays one note at a time with last-note priority, legato and glide |
| VOICE → Voices | How many notes can sound at once, 2 to 8. Turn it down mid-chord and the extra notes fade rather than cutting off |
| VOICE → Glide | Portamento time. Mono only: a poly voice that gets reused jumps to its new pitch instead of swooping |

When the pool is full the next note takes a voice back, choosing the least
audible one: an idle voice first, then the quietest note still fading out,
then the oldest note being held.

The pedal holds whatever the keys let go of. With the arpeggiator running it
holds the chord, like a momentary version of ARP → Latch.

Voices are summed straight, so a big chord at a high master volume can reach
the output ceiling. Volume is the headroom control until the ladder
filter and its drive stage arrive.

## MIDI control

Eight knobs are mapped for a controller's top row out of the box, on the CC
numbers a Launchkey Mini sends:

| CC | Knob |
|---|---|
| 21 | VCF → Cutoff |
| 22 | VCF → Reso |
| 23 | VCF → EG Int |
| 24 | VCF → Drive |
| 25 | AMP EG → Attack |
| 26 | AMP EG → Release |
| 27 | DELAY → Mix |
| 28 | REVERB → Mix |

Dials take over softly. A pot has a position of its own, and on plugging in it
will not agree with what is on screen, so a dial does nothing until it reaches
the value it is pointed at, then tracks it from there. While it waits, the knob
shows a small blue marker on its rim for where the pot is sitting, so you know
which way to turn. Dragging a knob on screen hands it back, and the dial has to
pick it up again.

To map something else, press **MIDI learn**, click the knob you want, and move
a dial. Click a knob you have armed a second time to clear it. Assignments are
saved in the browser and come back next time. Any knob on the panel can be
mapped; CC 64 stays the sustain pedal and cannot be reassigned.

## Arpeggiator

Turn **ARP → Arp** on and hold a chord. The lamp beside **Start audio** blinks
on every step and brightens on each count of four, and the on-screen keys light
up in blue as the pattern plays them.

| Knob | What it does |
|---|---|
| ARP → Arp | Turns the arpeggiator on. Off, notes pass straight through |
| ARP → Tempo | 30 to 300 bpm. The LFO and the delay sync to it too |
| ARP → Rate | Step length, from a whole note down to 1/32, including dotted and triplet divisions |
| ARP → Swing | Delays every second step. 33% is the classic 2:1 triplet shuffle, 0% is straight |
| ARP → Gate | How much of each step sounds. Turn it fully up to tie the steps together, which makes the arpeggio glide instead of retriggering |
| ARP → Mode | `up`, `down`, `up-down`, `down-up`, `as played`, `random` |
| ARP → Range | How many octaves the chord is stacked over |
| ARP → Ratchet | Repeats each step 2, 3, or 4 times inside its own slot |
| ARP → Latch | Keeps the pattern running after you let go. The next key you press starts a new chord |

Switching the arpeggiator off while keys are down hands those notes straight
back to the voice, so it is safe to flip mid-phrase.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm test` | Run the DSP test suite once |
| `npm run test:watch` | Tests in watch mode |
| `npm run typecheck` | TypeScript check with no output |
| `npm run build` | Typecheck then produce `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run deploy` | Deploy `dist/` to Workers by hand (CI normally does this) |
| `npm run deploy:version` | Upload a preview version without touching live traffic |

## Deploying to Cloudflare Workers

The app is entirely static. `wrangler.jsonc` points Workers at the `dist/`
folder as assets, and Web MIDI and AudioWorklet get the HTTPS they require.

Deploys are driven by **Workers Builds** from this GitHub repository, so a
merge to `main` is the deploy. No local wrangler login and no API token are
needed for normal work.

### One-time dashboard setup

1. In the Cloudflare dashboard, go to **Compute (Workers) → Create → Import a
   repository**, and authorize the Cloudflare GitHub app on this repo.
2. Pick this repository and set:

   | Field | Value |
   |---|---|
   | Project name | `midi-synthesizer` |
   | Production branch | `main` |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` |
   | Non-production branch deploy command | `npx wrangler versions upload` |
   | Root directory | `/` |

3. Leave **Build variables and secrets** empty. Nothing in this project reads
   an env var at build time. If that changes, add the value once under
   **Settings → Build → Variables and secrets** so it lives with the project
   rather than being pasted per build. Anything sensitive goes in as a
   *secret*, and runtime secrets are set under **Settings → Variables and
   Secrets** on the Worker itself.
4. Save. The first build starts immediately and the app lands at
   `https://midi-synthesizer.<your-subdomain>.workers.dev`.

Node version comes from `.node-version` (currently 22), so the build runner
and CI stay on the same major as local development.

### What happens on each push

| Event | Result |
|---|---|
| Merge to `main` | Build, then `wrangler deploy`. Live URL updates. |
| Push to any other branch (including PR branches) | Build, then `wrangler versions upload`. A preview version with its own URL, live traffic untouched. |

The preview URL appears in the build log and on the Worker's **Deployments**
tab, shaped like
`https://<version-prefix>-midi-synthesizer.<your-subdomain>.workers.dev`. It is
the fastest way to hear a change on a phone before merging.

GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, tests, and build on
every pull request. Cloudflare's build only typechecks, so treat a red CI check
as "do not merge".

### Deploying by hand

Rarely needed, but available:

```bash
npm run build
npm run deploy          # wrangler deploy, requires wrangler login
npm run deploy:version  # upload a preview version instead
```

## Project layout

```
src/dsp/        Pure TypeScript signal processing, no browser APIs
src/worklet/    AudioWorkletProcessor that hosts the synth on the audio thread
src/midi/       Web MIDI and computer keyboard input
src/ui/         Knob custom element, panel builder, on-screen keyboard
src/presets/    Patch JSON (empty until milestone 4)
test/           Vitest suite that renders audio offline and checks it
tools/          Optional Python analysis scripts (see tools/README.md)
.github/        CI workflow run on pull requests
```
