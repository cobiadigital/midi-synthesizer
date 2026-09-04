import { PARAMS, type ParamId, type PatchValues } from "../dsp/params";
import { SynthKnob } from "./knob";

export type ParamChangeHandler = (id: ParamId, value: number) => void;

/**
 * Builds the knob panel from the PARAMS registry, one section per `group`.
 * Returns a handle for pushing preset values back into the knobs.
 */
export class Panel {
  private readonly knobs = new Map<ParamId, SynthKnob>();

  constructor(container: HTMLElement, patch: PatchValues, onChange: ParamChangeHandler) {
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
      const knob = document.createElement(SynthKnob.tag) as SynthKnob;
      knob.bind(def, patch[def.id]);
      knob.addEventListener("change", (event) => {
        const { id, value } = (event as CustomEvent<{ id: ParamId; value: number }>).detail;
        onChange(id, value);
      });
      section.querySelector(".knob-row")!.appendChild(knob);
      this.knobs.set(def.id, knob);
    }
  }

  setPatch(patch: PatchValues): void {
    for (const [id, knob] of this.knobs) knob.value = patch[id];
  }
}
