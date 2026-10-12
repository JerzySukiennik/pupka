/* Icons from Lucide (ISC licence), bundled in lib/vendor.js so they work offline. */

import * as V from "../lib/vendor.js";

const MAP = {
  back: V.ArrowLeft, search: V.Search, calendar: V.CalendarDays, trash: V.Trash2, settings: V.SlidersHorizontal,
  undo: V.Undo2, redo: V.Redo2, list: V.List, listNum: V.ListOrdered, quote: V.Quote, table: V.TableIcon, image: V.ImageIcon,
  formula: V.Sigma, box: V.Frame, sign: V.Signature, pen: V.Pencil, marker: V.Highlighter, eraser: V.Eraser, lasso: V.Lasso,
  line: V.Slash, arrow: V.MoveUpRight, rect: V.Square, ellipse: V.Circle, text: V.Type, grid: V.Grip, eye: V.Eye, eyeOff: V.EyeOff,
  pages: V.SeparatorHorizontal, print: V.Printer, sparkle: V.Sparkles, send: V.SendHorizontal, close: V.X, plus: V.Plus,
  more: V.Ellipsis, chevron: V.ChevronDown, restore: V.RotateCcw, check: V.Check, offline: V.WifiOff, write: V.PenLine
};

export function icon(name, size = 18) {
  const node = MAP[name] || V.Frame;
  const body = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join("");
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
