import { GLOBAL_GROUP, PARAMS, type ParamDef, type ParamId, type PatchValues } from "../dsp/params";
import type { ControlElement } from "./control";
import { SynthSelect, SynthStepper, SynthSwitch } from "./discrete";
import { SynthKnob } from "./knob";

export interface PanelHandlers {
  change(id: ParamId, value: number): void;
  /** A knob was pressed while learn mode was on. */
  learn?(id: ParamId): void;
}

export interface PanelOptions {
  /** Where the collapsible sections go. */
  container: HTMLElement;
  /** The transport strip, for the handful of controls played rather than set. */
  globals: HTMLElement;
  patch: PatchValues;
  handlers: PanelHandlers;
}

const COLLAPSED_KEY = "midi-panel-collapsed";

/** Below this the panel is one column, and a section list beats a knob wall. */
const NARROW = "(max-width: 760px)";

/** Open on a phone the first time: enough to make a sound and shape it. */
const STARTER_GROUPS = new Set(["VCO 1", "MIXER", "VCF"]);

/**
 * Controls that do nothing at all in the current patch, and so are hidden
 * rather than left to be turned in vain. Only genuinely inert ones belong
 * here: a control that is merely unused stays on the panel, because hiding
 * it would move the rest under a finger mid-edit.
 */
const VISIBLE_WHEN: Partial<Record<ParamId, (p: PatchValues) => boolean>> = {
  // Sync swaps free rate for clock division, one or the other, never both.
  lfoRate: (p) => p.lfoSync < 0.5,
  lfoDivision: (p) => p.lfoSync >= 0.5,
  delayTime: (p) => p.delaySync < 0.5,
  delayDivision: (p) => p.delaySync >= 0.5,
  // Poly voices never glide, and mono has one voice by definition.
  glide: (p) => p.voiceMode < 0.5,
  polyVoices: (p) => p.voiceMode >= 0.5,
};

/**
 * Sections that are plainly doing something or not, shown as a lit dot on the
 * heading. With a section collapsed that dot is the only way to tell, and it
 * answers the question a folded panel otherwise raises: is anything on in
 * there? Groups with no such state (the mixer, the envelopes) are left out.
 */
const GROUP_ACTIVE: Record<string, (p: PatchValues) => boolean> = {
  "VCO 2": (p) => p.mixOsc2 > 0,
  LFO: (p) => p.lfoDepth > 0,
  ARP: (p) => p.arpOn >= 0.5,
  BUS: (p) => p.hpfCutoff > 20,
  DELAY: (p) => p.delayMix > 0,
  REVERB: (p) => p.reverbMix > 0,
};

/**
 * The widget a param asks for. Knob unless it says otherwise, which keeps the
 * registry in charge of the panel: a control changes shape by gaining one
 * field in `PARAMS`, not by special-casing anything here.
 */
function createControl(def: ParamDef): ControlElement {
  const tag =
    def.control === "switch"
      ? SynthSwitch.tag
      : def.control === "select"
        ? SynthSelect.tag
        : def.control === "stepper"
          ? SynthStepper.tag
          : SynthKnob.tag;
  return document.createElement(tag) as ControlElement;
}

/**
 * Builds the panel from the PARAMS registry, one section per `group`, in the
 * order the registry lists them, which is the order the signal flows.
 *
 * Sections collapse, and which are folded is remembered. That is what makes
 * the thing usable on a phone: fourteen headings and one open section instead
 * of two and a half thousand pixels of knobs between the player and the keys.
 * The `GLOBAL` group is lifted out into the transport strip, where volume,
 * tempo and the arpeggiator stay reachable whatever is folded.
 *
 * Returns a handle for pushing preset values back into the controls, and for
 * the MIDI feedback each one can show: its assignment and where its dial is.
 */
export class Panel {
  private readonly knobs = new Map<ParamId, ControlElement>();
  private readonly sections = new Map<string, HTMLElement>();
  private readonly collapsed: Set<string>;
  private patch: PatchValues;
  private armed: ParamId | null = null;

  constructor({ container, globals, patch, handlers }: PanelOptions) {
    this.patch = patch;
    this.collapsed = loadCollapsed();

    for (const def of PARAMS) {
      const row =
        def.group === GLOBAL_GROUP ? globalRow(globals) : this.section(container, def.group).querySelector(".knob-row")!;
      const control = createControl(def);
      control.bind(def, patch[def.id]);
      control.addEventListener("change", (event) => {
        const { id, value } = (event as CustomEvent<{ id: ParamId; value: number }>).detail;
        handlers.change(id, value);
        this.refresh();
      });
      control.addEventListener("learn", (event) => {
        const { id } = (event as CustomEvent<{ id: ParamId }>).detail;
        handlers.learn?.(id);
      });
      row.appendChild(control);
      this.knobs.set(def.id, control);
    }
    this.refresh();
  }

  setPatch(patch: PatchValues): void {
    this.patch = patch;
    for (const [id, knob] of this.knobs) knob.value = patch[id];
    this.refresh();
  }

  /** Move one control without going back through the change handler. */
  setValue(id: ParamId, value: number): void {
    const knob = this.knobs.get(id);
    if (!knob) return;
    knob.value = value;
    this.refresh();
  }

  /** Show where a physical dial is sitting while it waits to take a knob over. */
  setPot(id: ParamId, norm: number | null): void {
    this.knobs.get(id)?.setPot(norm);
  }

  clearPots(): void {
    for (const knob of this.knobs.values()) knob.setPot(null);
  }

  /**
   * Turn learn mode on or off across the panel. `label` supplies each knob's
   * assignment, which is only shown while learning. Every section opens: a
   * control folded away cannot be assigned, and a dial moved with the wrong
   * one armed is worse than a long page.
   */
  setLearnMode(on: boolean, label: (id: ParamId) => string | null): void {
    for (const [id, knob] of this.knobs) {
      knob.learnMode = on;
      knob.setMidiLabel(on ? label(id) ?? "—" : null);
    }
    if (on) for (const group of this.sections.keys()) this.setCollapsed(group, false, false);
    if (!on) this.setArmed(null);
  }

  /** Refresh the assignments shown, after one has been learned or cleared. */
  refreshLabels(label: (id: ParamId) => string | null): void {
    for (const [id, knob] of this.knobs) knob.setMidiLabel(label(id) ?? "—");
  }

  setArmed(id: ParamId | null): void {
    if (this.armed) this.knobs.get(this.armed)!.armed = false;
    this.armed = id;
    if (id) this.knobs.get(id)!.armed = true;
  }

  /** Apply everything that depends on the patch: what is inert, what is lit. */
  private refresh(): void {
    for (const [id, knob] of this.knobs) {
      const visible = VISIBLE_WHEN[id]?.(this.patch) ?? true;
      knob.hidden = !visible;
    }
    for (const [group, section] of this.sections) {
      section.classList.toggle("active", GROUP_ACTIVE[group]?.(this.patch) ?? false);
    }
  }

  private section(container: HTMLElement, group: string): HTMLElement {
    const existing = this.sections.get(group);
    if (existing) return existing;

    const section = document.createElement("section");
    section.className = "panel-group";
    const heading = document.createElement("h2");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "group-toggle";
    toggle.innerHTML = `<span class="group-name"></span><span class="group-dot"></span><span class="group-chevron"></span>`;
    (toggle.querySelector(".group-name") as HTMLElement).textContent = group;
    toggle.addEventListener("click", () => this.setCollapsed(group, !section.classList.contains("collapsed")));
    heading.appendChild(toggle);
    section.appendChild(heading);
    const row = document.createElement("div");
    row.className = "knob-row";
    section.appendChild(row);
    container.appendChild(section);
    this.sections.set(group, section);

    // First run on a phone opens only enough to make a sound; a wide screen
    // has room for the lot, and folding it would hide the instrument.
    const stored = this.collapsed.has(group);
    const narrow = window.matchMedia(NARROW).matches;
    this.setCollapsed(group, stored || (narrow && this.collapsed.size === 0 && !STARTER_GROUPS.has(group)), false);
    return section;
  }

  private setCollapsed(group: string, collapsed: boolean, persist = true): void {
    const section = this.sections.get(group);
    if (!section) return;
    section.classList.toggle("collapsed", collapsed);
    (section.querySelector(".group-toggle") as HTMLElement).setAttribute("aria-expanded", String(!collapsed));
    if (!persist) return;
    if (collapsed) this.collapsed.add(group);
    else this.collapsed.delete(group);
    saveCollapsed(this.collapsed);
  }
}

function globalRow(globals: HTMLElement): HTMLElement {
  let row = globals.querySelector(".knob-row");
  if (!row) {
    row = document.createElement("div");
    row.className = "knob-row";
    globals.appendChild(row);
  }
  return row as HTMLElement;
}

/**
 * Which sections are folded, remembered across reloads. An empty set means
 * nothing has been chosen yet, which is what the first-run default reads.
 */
function loadCollapsed(): Set<string> {
  try {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    const list: unknown = stored ? JSON.parse(stored) : [];
    return new Set(Array.isArray(list) ? list.filter((g): g is string => typeof g === "string") : []);
  } catch {
    // Private mode, or a half-written entry. Everything open is a fine answer.
    return new Set();
  }
}

function saveCollapsed(groups: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...groups]));
  } catch {
    // Storage refused. The panel still folds for this session.
  }
}
