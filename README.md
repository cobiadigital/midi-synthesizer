# Mono Synth

A monophonic subtractive synthesizer that runs in the browser, plays from a
MIDI keyboard, and is built to be deployed as a static PWA on Cloudflare
Workers. The design target is a hybrid of the Korg Minilogue's panel and
feature set with a Moog-style ladder filter.

## Status

Milestone 1 of 5, plus the filter from milestone 2 and the arpeggiator from
milestone 5. Current features:

- One anti-aliased oscillator (saw, square, triangle) with shape control
- Four-pole ladder filter with eight responses, drive, and resonance that
  self-oscillates in tune
- Filter envelope with a bipolar amount, key tracking, and velocity routing
- ADSR amplitude envelope
- Mono voice with last-note priority, legato, and glide
- Arpeggiator with six note orders, a four-octave range, and latch
- Sample-accurate step clock: tempo, division down to 1/32 and triplets,
  swing, gate length, and ratcheting
- Web MIDI input, on-screen keyboard, and computer-keyboard playing
- Offline-testable DSP core

Coming next: second oscillator, sub oscillator, noise and mixer, LFO and
modulation routing, presets, delay and chorus.
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
| Computer keyboard | `A S D F G H J K` are white keys, `W E T Y U` black keys. `Z` and `X` shift octave. |
| On-screen keys | Click or touch. Drag across keys for glissando. Lower on the key is louder. |

Knobs: drag up and down, hold Shift for fine control, double-click to reset,
scroll wheel for stepped changes.

## Filter

A four-pole transistor ladder. The **Mode** knob mixes its stage outputs, so
every response comes from the same filter and resonates at the same cutoff.

| Mode | What it does |
|---|---|
| `LP 24` / `LP 12` / `LP 6` | Lowpass at four, two, and one pole. 24 is the classic thick one, 6 is barely a tone control |
| `BP 24` / `BP 12` | Bandpass, two poles either side or one |
| `Notch` | Rejects the cutoff, passes everything else |
| `HP 12` / `HP 24` | Highpass at two and four poles |

| Knob | What it does |
|---|---|
| FILTER → Cutoff | 20 Hz to 18 kHz |
| FILTER → Reso | Emphasis at the cutoff. The top eighth of the knob self-oscillates, in tune, so the filter becomes a sine oscillator you can play with key tracking |
| FILTER → Drive | Pushes the ladder's input stage into saturation. Clean at the bottom of the knob |
| FILTER → Key | Cutoff follows the keyboard. At 1.0 it tracks semitone for semitone |
| FILTER → EG Int | How far the filter envelope moves the cutoff, in octaves. Negative amounts close the filter instead of opening it |
| FILTER → Vel | How far velocity opens the filter, up to three octaves |
| FILT EG | A dedicated ADSR for the filter, triggered with every note |

Resonance thins the low end as it climbs, the way the original does. Drive
gets that weight back.

## Arpeggiator

Turn **ARP → Arp** on and hold a chord. The lamp beside **Start audio** blinks
on every step and brightens on each count of four, and the on-screen keys light
up in blue as the pattern plays them.

| Knob | What it does |
|---|---|
| CLOCK → Tempo | 30 to 300 bpm |
| CLOCK → Rate | Step length, from a whole note down to 1/32, including dotted and triplet divisions |
| CLOCK → Swing | Delays every second step. 33% is the classic 2:1 triplet shuffle, 0% is straight |
| CLOCK → Gate | How much of each step sounds. Turn it fully up to tie the steps together, which makes the arpeggio glide instead of retriggering |
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
