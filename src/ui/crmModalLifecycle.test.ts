// @vitest-environment jsdom
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installCrmModalLifecycle } from './crmModalLifecycle';

let root: HTMLElement;
let opener: HTMLButtonElement;
let dispose: () => void;
let bodyStyle: string | null;
beforeEach(() => {
  bodyStyle = document.body.getAttribute('style');
  root = document.createElement('main');
  opener = document.createElement('button');
  opener.textContent = '打开详情';
  root.append(opener);
  document.body.append(root);
  opener.focus();
  dispose = installCrmModalLifecycle(root);
});
afterEach(() => {
  dispose();
  root.remove();
  if (bodyStyle === null) document.body.removeAttribute('style');
  else document.body.setAttribute('style', bodyStyle);
});

async function addDrawer() {
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  backdrop.innerHTML = '<aside role="dialog" aria-modal="true" tabindex="-1"><header class="drawer-header"><button class="icon-button">关闭</button></header><div class="drawer-content" style="overflow-y:auto"><button>第一项</button><button>打开确认</button></div></aside>';
  root.append(backdrop);
  const panel = backdrop.querySelector<HTMLElement>('aside')!;
  backdrop.querySelector('button')!.addEventListener('click', () => backdrop.remove());
  await flushPromises();
  return { backdrop, panel, buttons: panel.querySelectorAll<HTMLButtonElement>('button'), content: panel.querySelector<HTMLElement>('.drawer-content')! };
}
async function addDialog() {
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  backdrop.innerHTML = '<section role="alertdialog" aria-modal="true" tabindex="-1"><p>确认操作</p><footer><button class="button-secondary">取消</button><button>确认</button></footer></section>';
  root.append(backdrop);
  const panel = backdrop.querySelector<HTMLElement>('section')!;
  backdrop.querySelector('button')!.addEventListener('click', () => backdrop.remove());
  await flushPromises();
  return { backdrop, panel, buttons: panel.querySelectorAll<HTMLButtonElement>('button') };
}
function tab(shiftKey = false) {
  const event = new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
  document.activeElement!.dispatchEvent(event);
  return event;
}
function wheel(element: HTMLElement, deltaY = 10) {
  const event = new window.WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
}
function scrollSize(element: HTMLElement, clientHeight = 100, scrollHeight = 300) {
  Object.defineProperties(element, { clientHeight: { value: clientHeight, configurable: true }, scrollHeight: { value: scrollHeight, configurable: true } });
}

describe('CRM 局部模态行为与精确释放', () => {
  it('Tab/ShiftTab只在顶层循环，程序焦点也不能跑到背景', async () => {
    const drawer = await addDrawer();
    drawer.buttons[2].focus();
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(drawer.buttons[0]);
    expect(tab(true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(drawer.buttons[2]);
    opener.focus();
    expect(drawer.panel.contains(document.activeElement)).toBe(true);
  });

  it('嵌套Escape只关顶层，恢复下层来源焦点；最后关闭回到页面来源', async () => {
    const drawer = await addDrawer();
    drawer.buttons[2].focus();
    const dialog = await addDialog();
    const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    dialog.panel.dispatchEvent(event);
    await flushPromises();
    expect(event.defaultPrevented).toBe(true);
    expect(dialog.panel.isConnected).toBe(false);
    expect(drawer.panel.isConnected).toBe(true);
    expect(document.activeElement).toBe(drawer.buttons[2]);
    drawer.buttons[0].click();
    await flushPromises();
    expect(document.activeElement).toBe(opener);
  });

  it('背景与下层不可滚，顶层可滚，到边界阻断滚动传给背景', async () => {
    const drawer = await addDrawer();
    scrollSize(drawer.content);
    expect(wheel(drawer.content).defaultPrevented).toBe(false);
    const dialog = await addDialog();
    scrollSize(dialog.panel);
    expect(drawer.content.style.getPropertyValue('overflow-y')).toBe('hidden');
    expect(wheel(drawer.content).defaultPrevented).toBe(true);
    expect(wheel(opener).defaultPrevented).toBe(true);
    expect(wheel(dialog.panel).defaultPrevented).toBe(false);
    dialog.panel.scrollTop = 200;
    expect(wheel(dialog.panel).defaultPrevented).toBe(true);
    dialog.backdrop.remove();
    await flushPromises();
    expect(drawer.content.style.overflowY).toBe('auto');
    expect(wheel(drawer.content).defaultPrevented).toBe(false);
  });

  it('应用卸载精确恢复原style priority、滚动和inert，不改无关样式', async () => {
    root.style.setProperty('overflow-y', 'scroll', 'important');
    root.style.setProperty('color', 'red');
    root.scrollTop = 57;
    root.scrollLeft = 12;
    opener.setAttribute('inert', 'original');
    const drawer = await addDrawer();
    const dialog = await addDialog();
    expect(root.style.getPropertyValue('overflow-y')).toBe('hidden');
    expect(dialog.panel.style.getPropertyValue('max-height')).toBe('calc(100dvh - 40px)');
    root.scrollTop = 0;
    dispose();
    expect(root.style.getPropertyValue('overflow-y')).toBe('scroll');
    expect(root.style.getPropertyPriority('overflow-y')).toBe('important');
    expect(root.style.color).toBe('red');
    expect(root.scrollTop).toBe(57);
    expect(root.scrollLeft).toBe(12);
    expect(opener.getAttribute('inert')).toBe('original');
    expect(drawer.content.style.overflowY).toBe('auto');
    expect(dialog.panel.style.getPropertyValue('max-height')).toBe('');
    expect(dialog.panel.style.getPropertyValue('overflow-wrap')).toBe('');
    expect(dialog.panel.hasAttribute('style')).toBe(false);
  });
});
