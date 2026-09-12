/**
 * The About sheet: what this is, how to play it, how to install it, and where
 * to find the source or chip in.
 *
 * It slides up from the bottom, which is where a phone's thumb is, and the
 * title in the header is what opens it. That is the same handle the weather
 * app uses: an app's name is the thing people press when they want to know
 * what they are looking at, and it costs no room in a header that has none.
 */

const OPEN = "open";

export interface AboutOptions {
  button: HTMLButtonElement;
  sheet: HTMLElement;
  backdrop: HTMLElement;
  close: HTMLButtonElement;
}

export class AboutSheet {
  private readonly button: HTMLButtonElement;
  private readonly sheet: HTMLElement;
  private readonly backdrop: HTMLElement;

  constructor({ button, sheet, backdrop, close }: AboutOptions) {
    this.button = button;
    this.sheet = sheet;
    this.backdrop = backdrop;

    button.addEventListener("click", () => this.toggle());
    close.addEventListener("click", () => this.setOpen(false));
    backdrop.addEventListener("click", () => this.setOpen(false));
    // Escape closes it, and the key handler has to run before the computer
    // keyboard's note bindings see it.
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.isOpen) {
        event.stopPropagation();
        this.setOpen(false);
      }
    });
    // Closed to begin with, but without the focus move `setOpen` makes: on a
    // fresh load nothing has been opened, and pulling focus to the title would
    // put a focus ring on the header before anyone has touched anything.
    this.apply(false);
  }

  get isOpen(): boolean {
    return this.sheet.classList.contains(OPEN);
  }

  toggle(): void {
    this.setOpen(!this.isOpen);
  }

  setOpen(open: boolean): void {
    this.apply(open);
    // Closing hands focus back to what opened it, so a keyboard is not left
    // at the top of the document.
    if (!open) this.button.focus({ preventScroll: true });
  }

  private apply(open: boolean): void {
    this.sheet.classList.toggle(OPEN, open);
    this.backdrop.classList.toggle(OPEN, open);
    this.button.setAttribute("aria-expanded", String(open));
    // `inert` keeps a closed sheet off the tab order and away from a screen
    // reader without needing it removed from the document, which would cost
    // the slide.
    this.sheet.inert = !open;
  }
}
