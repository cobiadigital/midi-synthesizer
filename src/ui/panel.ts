import { PARAMS, type ParamDef, type ParamId, type PatchValues } from "../dsp/params";
import type { ControlElement } from "./control";
import { SynthSelect, SynthStepper, SynthSwitch } from "./discrete";
import { SynthKnob } from "./knob";

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

export interface PanelHandlers {
  change(id: ParamId, value: number): void;
  /** A knob was pressed while learn mode was on. */
  learn?(id: ParamId): void;
}

/**
 * Builds the panel from the PARAMS registry, one section per `group`.
 * Returns a handle for pushing preset values back into the knobs, and for the
 * MIDI feedback each knob can show: its assignment and where its dial is.
 */
export class Panel {
  private readonly knobs = new Map<ParamId, ControlElement>();
  private armed: ParamId | null = null;

  constructor(container: HTMLElement, patch: PatchValues, handlers: PanelHandlers) {
    const groups = new Map<string, HTMLElement>();
    for (const def of PARAMS) {
      let section = groups.get(def.group);
      if (!section) {
        section = document.createElement("section");
        section.className = "panel-group";
        const heading = document.createElement("h2");
        heading.textContent = def.group;
        section.appendChild(heading);
        const row = document.createElement("div");
        row.className = "knob-row";
        section.appendChild(row);
        container.appendChild(section);
        groups.set(def.group, section);
      }
      const knob = createControl(def);
      knob.bind(def, patch[def.id]);
      knob.addEventListener("change", (event) => {
        const { id, value } = (event as CustomEvent<{ id: ParamId; value: number }>).detail;
        handlers.change(id, value);
      });
      knob.addEventListener("learn", (event) => {
        const { id } = (event as CustomEvent<{ id: ParamId }>).detail;
        handlers.learn?.(id);
      });
      section.querySelector(".knob-row")!.appendChild(knob);
      this.knobs.set(def.id, knob);
    }
  }

  setPatch(patch: PatchValues): void {
    for (const [id, knob] of this.knobs) knob.value = patch[id];
  }

  /** Move one knob without going back through the change handler. */
  setValue(id: ParamId, value: number): void {
    const knob = this.knobs.get(id);
    if (knob) knob.value = value;
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
   * assignment, which is only shown while learning.
   */
  setLearnMode(on: boolean, label: (id: ParamId) => string | null): void {
    for (const [id, knob] of this.knobs) {
      knob.learnMode = on;
      knob.setMidiLabel(on ? label(id) ?? "—" : null);
    }
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
}
