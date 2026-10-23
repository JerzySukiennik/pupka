/* Small shared UI pieces: top bar, avatars, presence strip. */

import { esc } from "./md.js";
import { icon } from "./icons.js";

export function topbar({ back, title, right, nav }) {
  const left = back ? `<a class="icon-btn back" href="${back}" title="Wstecz">${icon("back")}</a><div class="tb-title">${title || ""}</div>` : `<a class="logo" href="#/">${icon("feather", 18)}<span>Pupka</span></a>${nav ? `<nav class="tb-nav">${nav}</nav>` : ""}`;
  return `<header class="topbar"><div class="tb-l">${left}</div><div class="tb-r">${right || ""}</div></header>`;
}

export function avatarHtml(user, size = 28, extraClass = "") {
  if (!user) return "";
  const color = user.color || "#888";
  const inner = user.avatar ? `<img src="${esc(user.avatar)}" alt="">` : `<span>${esc((user.name || "?")[0])}</span>`;
  return `<span class="avatar ${extraClass}" style="--c:${color};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.44)}px" title="${esc(user.name || "")}">${inner}</span>`;
}

export function presenceHtml(users, size = 26) {
  const seen = new Set();
  return `<span class="presence-strip">${users.filter((u) => u && u.name && !seen.has(u.name) && seen.add(u.name)).map((u) => avatarHtml(u, size)).join("")}</span>`;
}
