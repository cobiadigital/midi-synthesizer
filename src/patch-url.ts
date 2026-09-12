/**
 * The patch as a string, for the URL fragment and, later, for presets.
 *
 * Sparse and keyed by `ParamId`: only what differs from the factory patch is
 * written, so a link carries the sound rather than a dump of every knob, and
 * the default patch has no fragment at all. Nothing here persists a position
 * in `PARAMS`, which is what lets the panel be reordered without silently
 * re-interpreting links that are already out in the world. A param this build
 * no longer has is dropped on read, the same way `CcMap.fromJSON` drops a
 * binding whose param has gone: a renamed control costs one value, not the
 * whole patch.
 */

import {
  PARAMS,
  PARAM_INDEX,
  paramDef,
  snapParam,
  type ParamDef,
  type ParamId,
  type PatchValues,
} from "./dsp/params";

/** The fragment key, as in `#p=filterCutoff:820,arpOn:1`. */
export const PATCH_KEY = "p";

/**
 * Four significant figures. Across the widest log taper here (cutoff, 20 Hz
 * to 18 kHz) that is finer than a cent of pitch, so the rounding is inaudible
 * while keeping a value to four or five characters. Stepped params are
 * integers by definition and print as such.
 */
function formatValue(def: ParamDef, value: number): string {
  const snapped = snapParam(def, value);
  const text = def.step ? String(Math.round(snapped)) : String(Number(snapped.toPrecision(4)));
  // A leading zero before the point says nothing, and most params here are
  // 0..1, so dropping it is worth a character on most of the link.
  return text.replace(/^(-?)0\./, "$1.");
}

/**
 * What this patch changes from the factory one, in panel order. Compared after
 * formatting, so a knob nudged inside the rounding counts as untouched.
 *
 * This is what the link carries, and it is also what the shared image draws,
 * so the two say the same thing about a patch by construction rather than by
 * two lists being kept in step.
 */
export function changedParams(patch: Partial<PatchValues>): ParamId[] {
  const ids: ParamId[] = [];
  for (const def of PARAMS) {
    const value = patch[def.id];
    if (value === undefined || !Number.isFinite(value)) continue;
    if (formatValue(def, value) === formatValue(def, def.default)) continue;
    ids.push(def.id);
  }
  return ids;
}

/**
 * The patch as fragment text, or "" when nothing differs from the factory
 * patch.
 */
export function encodePatch(patch: Partial<PatchValues>): string {
  return changedParams(patch)
    .map((id) => `${id}:${formatValue(paramDef(id), patch[id] ?? 0)}`)
    .join(",");
}

/**
 * Fragment text back to values. Anything unreadable is skipped rather than
 * thrown: a link is user-editable text arriving from outside, and one bad
 * pair should cost that pair. Values are clamped and snapped on the way in,
 * so a hand-edited URL cannot put a control out of range.
 */
export function decodePatch(text: string): Partial<PatchValues> {
  const out: Partial<PatchValues> = {};
  for (const entry of text.split(",")) {
    const sep = entry.indexOf(":");
    if (sep <= 0) continue;
    const id = entry.slice(0, sep).trim() as ParamId;
    // `hasOwn` rather than `in`: PARAM_INDEX is a plain object, so `in` would
    // match "toString" and friends.
    if (!Object.hasOwn(PARAM_INDEX, id)) continue;
    const raw = entry.slice(sep + 1).trim();
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(raw)) continue;
    out[id] = snapParam(paramDef(id), Number(raw));
  }
  return out;
}

/** The patch in a whole fragment, or "" for the factory patch. */
export function patchFragment(patch: Partial<PatchValues>): string {
  const encoded = encodePatch(patch);
  return encoded ? `#${PATCH_KEY}=${encoded}` : "";
}

/** The values a fragment carries, empty for a fragment that carries none. */
export function patchFromFragment(fragment: string): Partial<PatchValues> {
  const text = new URLSearchParams(fragment.replace(/^#/, "")).get(PATCH_KEY);
  return text ? decodePatch(text) : {};
}
