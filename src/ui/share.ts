/**
 * The patch in the address bar.
 *
 * The fragment tracks the panel, so any moment is bookmarkable and the link
 * in the bar is always the sound being heard. It is a fragment rather than a
 * query string for two reasons: it never reaches the server, so Cloudflare's
 * cache stays one entry rather than one per patch, and changing it does not
 * reload the page.
 *
 * Writes are debounced. A knob drag emits a change per pointer move, and
 * WebKit throttles `replaceState` to roughly a hundred calls per thirty
 * seconds before it starts refusing them, which one sweep of the cutoff would
 * spend on its own.
 */

import type { PatchValues } from "../dsp/params";
import { patchFragment, patchFromFragment } from "../patch-url";

/** Long enough that a knob sweep writes once, short enough to bookmark. */
const WRITE_DELAY = 300;

export interface ShareOptions {
  /** Read for the current values whenever the fragment is written. */
  patch: PatchValues;
  /** A link was pasted into the running page: apply these values. */
  onIncoming(values: Partial<PatchValues>): void;
  /** Feedback for the share button, shown on the status line. */
  onStatus(text: string): void;
}

export class ShareLink {
  private readonly patch: PatchValues;
  private readonly onIncoming: (values: Partial<PatchValues>) => void;
  private readonly onStatus: (text: string) => void;
  private timer = 0;
  /** What we last put in the bar, so our own writes are not read back in. */
  private written = "";

  constructor({ patch, onIncoming, onStatus }: ShareOptions) {
    this.patch = patch;
    this.onIncoming = onIncoming;
    this.onStatus = onStatus;
    this.written = location.hash;
    // A hash-only navigation does not reload, so a link pasted into the bar
    // of a running page arrives here and nowhere else.
    window.addEventListener("hashchange", () => {
      if (location.hash === this.written) return;
      this.written = location.hash;
      this.onIncoming(patchFromFragment(location.hash));
    });
  }

  /** The values a link was opened with, for the patch the panel starts from. */
  static initialPatch(): Partial<PatchValues> {
    return patchFromFragment(location.hash);
  }

  /** Called for every param change, from the panel or from a MIDI dial. */
  schedule(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.write(), WRITE_DELAY);
  }

  /** The link as it stands, with the pending write applied first. */
  currentUrl(): string {
    clearTimeout(this.timer);
    this.write();
    return location.href;
  }

  /**
   * Hand the link over: the system sheet on a phone, the clipboard on a
   * desktop. Both need a secure context, which the synth already does.
   */
  async share(): Promise<void> {
    const url = this.currentUrl();
    try {
      if (navigator.share) {
        await navigator.share({ title: "Poly Synth", text: "A patch for Poly Synth", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      this.onStatus("Link copied. It carries every knob and switch on the panel.");
    } catch (err) {
      // A cancelled share sheet lands here too, and saying nothing is right.
      if ((err as Error).name === "AbortError") return;
      this.onStatus("Could not copy the link. It is in the address bar.");
    }
  }

  private write(): void {
    const fragment = patchFragment(this.patch);
    // An empty fragment still needs the bare path, or the last link stays in
    // the bar after the patch comes back to the factory settings.
    const url = `${location.pathname}${location.search}${fragment}`;
    history.replaceState(history.state, "", url);
    this.written = fragment;
  }
}
