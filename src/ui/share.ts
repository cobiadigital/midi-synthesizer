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
import { renderPatchCard } from "./patch-card";

/** Long enough that a knob sweep writes once, short enough to bookmark. */
const WRITE_DELAY = 300;

const IMAGE_NAME = "poly-synth-patch.png";

export interface ShareOptions {
  /** Read for the current values whenever the fragment is written. */
  patch: PatchValues;
  /** Disabled while the picture is being drawn, since it is not instant. */
  button: HTMLButtonElement;
  /** A link was pasted into the running page: apply these values. */
  onIncoming(values: Partial<PatchValues>): void;
  /** Feedback for the share button, shown on the status line. */
  onStatus(text: string): void;
}

export class ShareLink {
  private readonly patch: PatchValues;
  private readonly button: HTMLButtonElement;
  private readonly onIncoming: (values: Partial<PatchValues>) => void;
  private readonly onStatus: (text: string) => void;
  private timer = 0;
  /** What we last put in the bar, so our own writes are not read back in. */
  private written = "";

  constructor({ patch, button, onIncoming, onStatus }: ShareOptions) {
    this.patch = patch;
    this.button = button;
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
   * Hand the patch over as a picture and a link: the system share sheet on a
   * phone, the clipboard and a saved PNG on a desktop.
   *
   * The link goes in `text` as a full https:// URL rather than in `url`.
   * Both carry it, but iOS treats a share with `url` set as a link share and
   * quietly drops the attachment, so the picture would never arrive.
   */
  async share(): Promise<void> {
    const url = this.currentUrl();
    this.button.disabled = true;
    this.onStatus("Drawing the patch…");
    try {
      const file = await this.card();
      const text = `A patch for Poly Synth\n${url}`;
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Poly Synth", text });
        this.onStatus("Shared.");
        return;
      }
      // No file sharing here, so hand over both halves separately: the link
      // to the clipboard, the picture to the downloads folder.
      await navigator.clipboard.writeText(url);
      if (file) {
        download(file);
        this.onStatus("Link copied, and the patch image saved.");
      } else {
        this.onStatus("Link copied. It carries every knob and switch on the panel.");
      }
    } catch (err) {
      // Dismissing the share sheet throws AbortError. Nothing went wrong, but
      // the status line is still saying the picture is being drawn, so it has
      // to be told otherwise.
      this.onStatus(
        (err as Error).name === "AbortError"
          ? "Share cancelled."
          : "Could not share. The link is in the address bar.",
      );
    } finally {
      this.button.disabled = false;
    }
  }

  /**
   * The picture, or null if this browser cannot make one. A card that fails
   * to draw must not cost the link: the share carries on without it.
   */
  private async card(): Promise<File | null> {
    try {
      const blob = await renderPatchCard(this.patch, location.host || "poly synth");
      return new File([blob], IMAGE_NAME, { type: "image/png" });
    } catch {
      return null;
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

/** Save a file the browser cannot share, the only fallback a desktop needs. */
function download(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  // Revoking immediately can beat the download on some browsers; a frame is
  // enough and the object is small.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
