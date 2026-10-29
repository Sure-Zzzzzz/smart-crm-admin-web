type StyleSnapshot = { element: HTMLElement; hadStyle: boolean; values: { property: string; value: string; priority: string }[] };
type ScrollSnapshot = StyleSnapshot & { left: number; top: number };
type Layer = { panel: HTMLElement; opener: HTMLElement | null; lastFocus: HTMLElement | null; viewport?: StyleSnapshot };

function rememberStyle(element: HTMLElement, properties: string[]): StyleSnapshot {
  return { element, hadStyle: element.hasAttribute('style'), values: properties.map(property => ({ property, value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) })) };
}
function restoreStyle(snapshot: StyleSnapshot): void {
  for (const { property } of snapshot.values) snapshot.element.style.removeProperty(property);
  for (const { property, value, priority } of snapshot.values) {
    if (value) snapshot.element.style.setProperty(property, value, priority);
  }
  if (!snapshot.hadStyle && !snapshot.element.style.length) snapshot.element.removeAttribute('style');
}

/** 在 CRM 容器内补齐模态生命周期，保留契约的布局、事件及焦点入口。 */
export function installCrmModalLifecycle(root: HTMLElement): () => void {
  const document = root.ownerDocument;
  const view = document.defaultView!;
  const selector = '[aria-modal="true"][role="dialog"], [aria-modal="true"][role="alertdialog"]';
  let layers: Layer[] = [];
  let background: ScrollSnapshot[] = [];
  let inert: { element: HTMLElement; original: string | null }[] = [];
  let externalFocus = document.activeElement instanceof view.HTMLElement ? document.activeElement : null;
  let redirecting = false;
  let disposed = false;
  let touchX = 0;
  let touchY = 0;

  function focus(element: HTMLElement | null): void {
    if (!element?.isConnected || element.closest('[inert]')) return;
    redirecting = true;
    element.focus({ preventScroll: true });
    redirecting = false;
  }
  function restoreBackground(): void {
    for (const snapshot of background) {
      restoreStyle(snapshot);
      snapshot.element.scrollLeft = snapshot.left;
      snapshot.element.scrollTop = snapshot.top;
    }
    background = [];
    for (const snapshot of inert) {
      if (snapshot.original === null) snapshot.element.removeAttribute('inert');
      else snapshot.element.setAttribute('inert', snapshot.original);
    }
    inert = [];
  }
  function lockBackground(top: HTMLElement): void {
    const candidates = new Set<HTMLElement>();
    for (let element: HTMLElement | null = root; element; element = element.parentElement) candidates.add(element);
    for (const element of root.querySelectorAll<HTMLElement>('*')) {
      if (element === top || top.contains(element) || element.contains(top)) continue;
      const style = view.getComputedStyle(element);
      if (/(auto|scroll)/.test(style.overflowX + style.overflowY)) candidates.add(element);
    }
    for (const element of candidates) {
      background.push({ ...rememberStyle(element, ['overflow', 'overflow-x', 'overflow-y']), left: element.scrollLeft, top: element.scrollTop });
      element.style.setProperty('overflow-x', 'hidden', 'important');
      element.style.setProperty('overflow-y', 'hidden', 'important');
    }
    // 仅让模态祖先链的兄弟分支静默；祖先本身不能 inert，否则顶层一起失效。
    for (let branch = top; branch.parentElement; branch = branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof view.HTMLElement) {
          inert.push({ element: sibling, original: sibling.getAttribute('inert') });
          sibling.setAttribute('inert', '');
        }
      }
      if (branch.parentElement === document.body) break;
    }
  }
  function synchronize(): void {
    if (disposed) return;
    const panels = Array.from(root.querySelectorAll<HTMLElement>(selector));
    const added = panels.filter(panel => !layers.some(layer => layer.panel === panel));
    const removed = layers.filter(layer => !panels.includes(layer.panel));
    if (!added.length && !removed.length) return;
    const previousTop = layers.at(-1);
    restoreBackground();
    for (const layer of removed) if (layer.viewport) restoreStyle(layer.viewport);
    layers = layers.filter(layer => panels.includes(layer.panel));
    for (const panel of added) {
      const active = document.activeElement instanceof view.HTMLElement ? document.activeElement : null;
      const opener = active && !panel.contains(active) ? active : layers.at(-1)?.lastFocus ?? externalFocus;
      let viewport: StyleSnapshot | undefined;
      if (panel.getAttribute('role') === 'alertdialog') {
        viewport = rememberStyle(panel, ['max-height', 'overflow-y', 'overflow-wrap']);
        panel.style.setProperty('max-height', 'calc(100dvh - 40px)');
        panel.style.setProperty('overflow-y', 'auto');
        panel.style.setProperty('overflow-wrap', 'anywhere');
      }
      layers.push({ panel, opener, lastFocus: null, viewport });
    }
    const top = layers.at(-1);
    if (top) {
      lockBackground(top.panel);
      const active = document.activeElement;
      if (!top.panel.contains(active)) {
        const source = previousTop && removed.includes(previousTop) ? previousTop.opener : top.lastFocus;
        focus(source && top.panel.contains(source) ? source : top.panel);
      }
    } else if (previousTop) focus(previousTop.opener);
  }
  function focusables(panel: HTMLElement): HTMLElement[] {
    return Array.from(panel.querySelectorAll<HTMLElement>('a[href],button,input,textarea,select,[tabindex]')).filter(element => {
      if (element.tabIndex < 0 || element.matches(':disabled') || element.closest('[inert], [hidden]')) return false;
      for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
        const style = view.getComputedStyle(ancestor);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (ancestor === panel) break;
      }
      return true;
    });
  }
  function keydown(event: KeyboardEvent): void {
    synchronize();
    const top = layers.at(-1);
    if (!top) return;
    if (event.key === 'Escape') {
      // 契约的各层均监听 document；阻断广播，Escape 只交给顶层。
      event.preventDefault();
      event.stopImmediatePropagation();
      const expanded = top.panel.querySelector<HTMLButtonElement>('.form-select-toggle[aria-expanded="true"]');
      if (expanded) expanded.click();
      else top.panel.querySelector<HTMLButtonElement>(top.panel.getAttribute('role') === 'alertdialog' ? 'footer .button-secondary' : '.drawer-header .icon-button')?.click();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = focusables(top.panel);
    const active = document.activeElement;
    const index = controls.indexOf(active as HTMLElement);
    if (!controls.length || index < 0 || (!event.shiftKey && index === controls.length - 1) || (event.shiftKey && index === 0)) {
      event.preventDefault();
      focus(controls.length ? controls[event.shiftKey ? controls.length - 1 : 0] : top.panel);
    }
  }
  function focusin(event: FocusEvent): void {
    if (redirecting) return;
    synchronize();
    const top = layers.at(-1);
    const target = event.target instanceof view.HTMLElement ? event.target : null;
    if (!top) { externalFocus = target; return; }
    if (target && top.panel.contains(target)) top.lastFocus = target;
    else focus(top.lastFocus?.isConnected ? top.lastFocus : top.panel);
  }
  function consumeScroll(target: EventTarget | null, x: number, y: number): boolean {
    const top = layers.at(-1)?.panel;
    if (!top || !(target instanceof view.HTMLElement) || !top.contains(target)) return false;
    for (let element: HTMLElement | null = target; element; element = element.parentElement) {
      const style = view.getComputedStyle(element);
      const horizontal = /(auto|scroll)/.test(style.overflowX) && (x < 0 ? element.scrollLeft > 0 : x > 0 && element.scrollLeft + element.clientWidth < element.scrollWidth);
      const vertical = /(auto|scroll)/.test(style.overflowY) && (y < 0 ? element.scrollTop > 0 : y > 0 && element.scrollTop + element.clientHeight < element.scrollHeight);
      if (horizontal || vertical) return true;
      if (element === top) break;
    }
    return false;
  }
  function wheel(event: WheelEvent): void {
    if (layers.length && !consumeScroll(event.target, event.deltaX, event.deltaY)) event.preventDefault();
  }
  function touchstart(event: TouchEvent): void {
    touchX = event.touches[0]?.clientX ?? 0;
    touchY = event.touches[0]?.clientY ?? 0;
  }
  function touchmove(event: TouchEvent): void {
    const point = event.touches[0];
    if (!point) return;
    if (layers.length && !consumeScroll(event.target, touchX - point.clientX, touchY - point.clientY)) event.preventDefault();
    touchX = point.clientX;
    touchY = point.clientY;
  }

  const observer = new view.MutationObserver(synchronize);
  observer.observe(root, { childList: true, subtree: true });
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('focusin', focusin, true);
  document.addEventListener('wheel', wheel, { capture: true, passive: false });
  document.addEventListener('touchstart', touchstart, { capture: true, passive: true });
  document.addEventListener('touchmove', touchmove, { capture: true, passive: false });
  synchronize();
  return () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    document.removeEventListener('keydown', keydown, true);
    document.removeEventListener('focusin', focusin, true);
    document.removeEventListener('wheel', wheel, true);
    document.removeEventListener('touchstart', touchstart, true);
    document.removeEventListener('touchmove', touchmove, true);
    restoreBackground();
    for (const layer of layers) if (layer.viewport) restoreStyle(layer.viewport);
    focus(layers[0]?.opener ?? null);
    layers = [];
  };
}
