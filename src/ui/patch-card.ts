/**
 * The patch as a picture, for sharing as a file.
 *
 * Drawn onto a canvas from `PARAMS` and the patch rather than captured off
 * the page. Every control is a custom element with a shadow root, and the DOM
 * capture libraries cannot see inside one, so a screenshot of the panel would
 * come out as a grid of empty boxes. Drawing it means the card can also say
 * what a screenshot cannot: only the controls this patch actually moved, and
 * the waveform the patch makes.
 *
 * What counts as moved is `changedParams`, the same list the shareable link
 * carries, so the picture and the link cannot disagree about a patch.
 */

import { formatParamValue, paramToNorm, PARAMS, type ParamDef, type PatchValues } from "../dsp/params";
import { changedParams } from "../patch-url";
import { renderPatchPreview, waveformEnvelope } from "../patch-preview";
import { isControlVisible } from "./panel";

// The panel's own colours, so the card is recognisably the same instrument.
const BG = "#141414";
const PANEL = "#1f1f1f";
const EDGE = "#2c2c2c";
const TEXT = "#e8e8e8";
const MUTED = "#8a8a8a";
const ACCENT = "#f5a623";
const TRACK = "#333";
const CAP = "#1c1c1c";
const RIM = "#555";

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const WIDTH = 720;
const PAD = 26;
const GAP = 14;
const COLUMNS = 3;
const WAVE_HEIGHT = 152;

/** One control's cell: the dial, its label, its value. */
const CELL_W = 60;
const CELL_H = 78;
const DIAL_R = 21;

interface Section {
  group: string;
  defs: ParamDef[];
  height: number;
}

/**
 * Render the card and resolve a PNG blob.
 *
 * Two-pass: lay the sections out to find the height, then draw, because a
 * canvas cannot be resized without clearing it and the height depends on how
 * much of the panel this patch touched.
 */
export async function renderPatchCard(patch: PatchValues, siteName: string): Promise<Blob> {
  const sections = layout(patch);
  const columns = packColumns(sections);
  const bodyHeight = Math.max(0, ...columns.map(columnHeight));
  const top = PAD + 34 + 16 + WAVE_HEIGHT + 20;
  const height = top + bodyHeight + 46 + PAD;

  // 2x for a crisp card without a huge file on a hi-dpi phone, matching what
  // the map share does.
  const scale = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(WIDTH * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.scale(scale, scale);
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, WIDTH, height);

  drawTitle(ctx, patch);
  drawWaveform(ctx, patch, PAD + 34 + 16);
  drawColumns(ctx, columns, patch, top);
  drawFooter(ctx, siteName, height);

  return toBlob(canvas);
}

function drawTitle(ctx: CanvasRenderingContext2D, patch: PatchValues): void {
  const y = PAD + 22;
  ctx.fillStyle = TEXT;
  ctx.font = `600 21px ${FONT}`;
  ctx.letterSpacing = "3.4px";
  ctx.fillText("POLY SYNTH", PAD, y);
  ctx.letterSpacing = "0px";

  const moved = changedParams(patch).filter((id) => isControlVisible(id, patch)).length;
  ctx.fillStyle = MUTED;
  ctx.font = `400 12px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(moved === 0 ? "factory patch" : `${moved} control${moved === 1 ? "" : "s"} moved`, WIDTH - PAD, y);
  ctx.textAlign = "left";
}

/**
 * The sound itself, rendered offline through the real DSP. Scaled to the
 * peak so the shape fills the box whatever the volume, with the full-scale
 * lines drawn in so a patch running hot is visible rather than flattered.
 */
function drawWaveform(ctx: CanvasRenderingContext2D, patch: PatchValues, y: number): void {
  const w = WIDTH - PAD * 2;
  panel(ctx, PAD, y, w, WAVE_HEIGHT);

  const preview = renderPatchPreview(patch);
  const inner = { x: PAD + 12, y: y + 12, w: w - 24, h: WAVE_HEIGHT - 40 };
  const mid = inner.y + inner.h / 2;
  const scale = preview.peak > 0 ? inner.h / 2 / preview.peak : 0;

  // Full scale, so a wave that reaches these lines is as loud as the output
  // can carry and one that passes them is clipping.
  if (preview.peak > 1) {
    ctx.strokeStyle = "#463019";
    ctx.lineWidth = 1;
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(inner.x, Math.round(mid + sign * scale) + 0.5);
      ctx.lineTo(inner.x + inner.w, Math.round(mid + sign * scale) + 0.5);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(inner.x, Math.round(mid) + 0.5);
  ctx.lineTo(inner.x + inner.w, Math.round(mid) + 0.5);
  ctx.stroke();

  // Right channel behind, left in front: they coincide exactly until an
  // effect makes the output stereo, and then the width is the picture.
  drawChannel(ctx, preview.right, inner, mid, scale, "rgba(245, 166, 35, 0.35)");
  drawChannel(ctx, preview.left, inner, mid, scale, ACCENT);

  // Where the keys came up, so the shape reads as hold then release.
  const releaseX = inner.x + (preview.releaseAt / preview.left.length) * inner.w;
  ctx.strokeStyle = "rgba(232, 232, 232, 0.25)";
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(Math.round(releaseX) + 0.5, inner.y);
  ctx.lineTo(Math.round(releaseX) + 0.5, inner.y + inner.h);
  ctx.stroke();
  ctx.setLineDash([]);

  const seconds = preview.left.length / preview.sampleRate;
  ctx.fillStyle = MUTED;
  ctx.font = `400 10px ${FONT}`;
  ctx.fillText(`${seconds.toFixed(1)}s of a four-note chord, rendered from this patch`, inner.x, y + WAVE_HEIGHT - 12);
  ctx.textAlign = "right";
  ctx.fillStyle = preview.peak > 1 ? "#e0813a" : MUTED;
  ctx.fillText(`peak ${preview.peak.toFixed(2)}`, inner.x + inner.w, y + WAVE_HEIGHT - 12);
  ctx.textAlign = "left";
}

function drawChannel(
  ctx: CanvasRenderingContext2D,
  samples: Float32Array,
  box: { x: number; y: number; w: number; h: number },
  mid: number,
  scale: number,
  colour: string,
): void {
  const columns = Math.round(box.w);
  const { min, max } = waveformEnvelope(samples, columns);
  ctx.fillStyle = colour;
  ctx.beginPath();
  for (let c = 0; c < columns; c++) {
    const hi = mid - (max[c] ?? 0) * scale;
    const lo = mid - (min[c] ?? 0) * scale;
    // A column with no signal in it is still a hairline, so silence reads as
    // a flat line rather than a gap.
    ctx.rect(box.x + c, hi, 1, Math.max(1, lo - hi));
  }
  ctx.fill();
}

/** The sections this patch touched, each sized by how many controls it shows. */
function layout(patch: PatchValues): Section[] {
  const moved = new Set(changedParams(patch).filter((id) => isControlVisible(id, patch)));
  const sections: Section[] = [];
  for (const def of PARAMS) {
    if (!moved.has(def.id)) continue;
    const last = sections[sections.length - 1];
    if (last?.group === def.group) last.defs.push(def);
    else sections.push({ group: def.group, defs: [def], height: 0 });
  }
  const perRow = Math.floor((columnWidth() - 20) / CELL_W);
  for (const section of sections) {
    section.height = 30 + Math.ceil(section.defs.length / perRow) * CELL_H + 10;
  }
  return sections;
}

function columnWidth(): number {
  return (WIDTH - PAD * 2 - GAP * (COLUMNS - 1)) / COLUMNS;
}

function columnHeight(column: Section[]): number {
  return column.reduce((sum, s) => sum + s.height + GAP, 0);
}

/**
 * Shortest column first, the way the panel's CSS columns pack on screen. The
 * sections are different heights and a fixed split would leave one column
 * long and two short.
 */
function packColumns(sections: Section[]): Section[][] {
  const columns: Section[][] = Array.from({ length: COLUMNS }, () => []);
  for (const section of sections) {
    let shortest = 0;
    for (let i = 1; i < COLUMNS; i++) {
      if (columnHeight(columns[i]!) < columnHeight(columns[shortest]!)) shortest = i;
    }
    columns[shortest]!.push(section);
  }
  return columns;
}

function drawColumns(ctx: CanvasRenderingContext2D, columns: Section[][], patch: PatchValues, top: number): void {
  const w = columnWidth();
  columns.forEach((column, i) => {
    let y = top;
    for (const section of column) {
      drawSection(ctx, section, patch, PAD + i * (w + GAP), y, w);
      y += section.height + GAP;
    }
  });
}

function drawSection(
  ctx: CanvasRenderingContext2D,
  section: Section,
  patch: PatchValues,
  x: number,
  y: number,
  w: number,
): void {
  panel(ctx, x, y, w, section.height);
  ctx.fillStyle = MUTED;
  ctx.font = `600 10px ${FONT}`;
  ctx.letterSpacing = "1.4px";
  ctx.fillText(section.group, x + 12, y + 19);
  ctx.letterSpacing = "0px";

  const perRow = Math.floor((w - 20) / CELL_W);
  section.defs.forEach((def, i) => {
    const cx = x + 10 + (i % perRow) * CELL_W + CELL_W / 2;
    const cy = y + 30 + Math.floor(i / perRow) * CELL_H;
    drawControl(ctx, def, patch[def.id], cx, cy);
  });
}

/**
 * One control, drawn as the panel draws it: a dial for a knob, a pill with
 * the chosen word for the selects and switches. Same 270 degree sweep from
 * -135, same accent arc, so the card reads as the panel it came from.
 */
function drawControl(ctx: CanvasRenderingContext2D, def: ParamDef, value: number, cx: number, cy: number): void {
  const norm = paramToNorm(def, value);
  const midY = cy + DIAL_R + 2;
  const discrete = def.control === "select" || def.control === "switch" || def.control === "stepper";

  if (discrete) {
    drawPill(ctx, def, value, cx, midY);
  } else {
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = TRACK;
    arc(ctx, cx, midY, DIAL_R - 2, 0, 1);
    ctx.strokeStyle = ACCENT;
    if (norm > 0.001) arc(ctx, cx, midY, DIAL_R - 2, 0, norm);

    ctx.beginPath();
    ctx.arc(cx, midY, DIAL_R - 6, 0, Math.PI * 2);
    ctx.fillStyle = CAP;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = RIM;
    ctx.stroke();

    const a = ((-135 + norm * 270 - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx, midY);
    ctx.lineTo(cx + Math.cos(a) * (DIAL_R - 8), midY + Math.sin(a) * (DIAL_R - 8));
    ctx.strokeStyle = "#eee";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  ctx.textAlign = "center";
  ctx.fillStyle = MUTED;
  ctx.font = `400 9px ${FONT}`;
  ctx.letterSpacing = "0.5px";
  ctx.fillText(def.label.toUpperCase(), cx, cy + CELL_H - 27);
  ctx.letterSpacing = "0px";
  // A dial needs its value spelled out underneath; a pill already says it.
  if (!discrete) {
    ctx.fillStyle = ACCENT;
    ctx.font = `400 10px ${FONT}`;
    ctx.fillText(fit(ctx, formatParamValue(def, value), CELL_W - 4), cx, cy + CELL_H - 14);
  }
  ctx.textAlign = "left";
}

/** A select, switch or stepper: the chosen word in a box, as on the panel. */
function drawPill(ctx: CanvasRenderingContext2D, def: ParamDef, value: number, cx: number, cy: number): void {
  const w = CELL_W - 10;
  const h = 22;
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 4);
  const on = def.control === "switch" ? value >= 0.5 : true;
  ctx.fillStyle = on ? "rgba(245, 166, 35, 0.16)" : PANEL;
  ctx.fill();
  ctx.strokeStyle = on ? ACCENT : EDGE;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.fillStyle = on ? ACCENT : MUTED;
  ctx.font = `500 10px ${FONT}`;
  ctx.fillText(fit(ctx, formatParamValue(def, value), w - 6), cx, cy + 3.5);
  ctx.textAlign = "left";
}

function drawFooter(ctx: CanvasRenderingContext2D, siteName: string, height: number): void {
  const y = height - PAD - 6;
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, Math.round(y - 20) + 0.5);
  ctx.lineTo(WIDTH - PAD, Math.round(y - 20) + 0.5);
  ctx.stroke();

  ctx.fillStyle = MUTED;
  ctx.font = `400 11px ${FONT}`;
  ctx.fillText(siteName, PAD, y);
  ctx.textAlign = "right";
  ctx.fillText("the link opens this patch", WIDTH - PAD, y);
  ctx.textAlign = "left";
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  roundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = PANEL;
  ctx.fill();
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The knob's 270 degree sweep, in canvas angles. */
function arc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, from: number, to: number): void {
  const start = ((-135 + from * 270 - 90) * Math.PI) / 180;
  const end = ((-135 + to * 270 - 90) * Math.PI) / 180;
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, end);
  ctx.stroke();
}

/** Shrink a readout until it fits its cell, rather than letting it collide. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(out + "…").width > max) out = out.slice(0, -1);
  return out + "…";
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))), "image/png");
  });
}
