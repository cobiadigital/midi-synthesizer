# Mono Synth

A monophonic subtractive synthesizer that runs in the browser, plays from a
MIDI keyboard, and is built to be deployed as a static PWA on Cloudflare
Workers. The design target is a hybrid of the Korg Minilogue's panel and
feature set with a Moog-style ladder filter.

## Status

Milestone 1 of 5. Current features:

- One anti-aliased oscillator (saw, square, triangle) with shape control
- ADSR amplitude envelope
- Mono voice with last-note priority, legato, and glide
- Web MIDI input, on-screen keyboard, and computer-keyboard playing
- Offline-testable DSP core

Coming next: second oscillator and mixer, Moog ladder filter, filter
envelope, LFO and modulation routing, presets, arpeggiator, effects.
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

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm test` | Run the DSP test suite once |
| `npm run test:watch` | Tests in watch mode |
| `npm run typecheck` | TypeScript check with no output |
| `npm run build` | Typecheck then produce `dist/` |
| `npm run preview` | Serve the production build locally |

## Deploying to Cloudflare Workers

The app is entirely static. `wrangler.jsonc` points Workers at the `dist/`
folder as assets.

```bash
npm run build
npx wrangler deploy
```

Web MIDI and AudioWorklet both require HTTPS, which Workers provides.

## Project layout

```
src/dsp/        Pure TypeScript signal processing, no browser APIs
src/worklet/    AudioWorkletProcessor that hosts the voice on the audio thread
src/midi/       Web MIDI and computer keyboard input
src/ui/         Knob custom element, panel builder, on-screen keyboard
src/presets/    Patch JSON (empty until milestone 4)
test/           Vitest suite that renders audio offline and checks it
tools/          Optional Python analysis scripts (see tools/README.md)
```
