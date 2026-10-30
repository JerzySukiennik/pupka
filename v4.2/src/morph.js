/* Screen transitions: View Transitions with shared elements (subject name → title, lesson row → page), and where we came from. */

export const from = { card: null, subject: null };
export const NAMES = { title: "vt-title", page: "vt-page", ctitle: "vt-ctitle" };

export function vt(name, on) { return on ? ` style="view-transition-name:${name}"` : ""; }

function clearTags() { document.querySelectorAll('[style*="view-transition-name"]').forEach((el) => { el.style.viewTransitionName = ""; }); }
function tag(el, name) { if (el) el.style.viewTransitionName = name; }

document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest(".toc-link, .pc a, .plan-grid a, a.row, a.thumb, button[data-pick]");
  if (!a) return;
  clearTags();
  if (a.matches(".toc-link")) tag(a.querySelector(".toc-name"), NAMES.title);
  else if (a.matches(".pc a, .plan-grid a")) tag(a, NAMES.title);
  else if (a.matches("a.row")) { tag(a, NAMES.page); tag(a.querySelector(".row-title"), NAMES.ctitle); }
  else if (a.matches("a.thumb")) { tag(a, NAMES.page); tag(a.querySelector("b"), NAMES.ctitle); }
  else if (a.matches("button[data-pick]")) tag(a, NAMES.page);
}, true);

export function canAnimate() { return !!document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches; }

export function transition(update) {
  if (!canAnimate()) { update(); return; }
  try { document.startViewTransition(update); } catch (e) { update(); }
}
