/**
 * 极简 DOM 工具：只用 textContent / 文本节点，不用 innerHTML，导入的课程名等内容不会被当作 HTML 解析。
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  const p = props || {};
  for (const key of Object.keys(p)) {
    const v = p[key];
    if (key.startsWith('aria-') && typeof v === 'boolean') {
      // aria 布尔属性必须写成 "true"/"false" 字符串，空串不会命中 [aria-pressed="true"]
      el.setAttribute(key, String(v));
      continue;
    }
    if (v === null || v === undefined || v === false) {
      continue;
    }
    if (key === 'class') {
      el.className = v;
    } else if (key === 'style' && typeof v === 'object') {
      for (const name of Object.keys(v)) {
        if (name.includes('-')) {
          el.style.setProperty(name, v[name]);
        } else {
          el.style[name] = v[name];
        }
      }
    } else if (key.startsWith('on') && typeof v === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), v);
    } else if (key === 'value') {
      el.value = v;
    } else {
      el.setAttribute(key, v === true ? '' : String(v));
    }
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) {
      continue;
    }
    if (Array.isArray(k)) {
      append(el, k);
    } else if (k instanceof Node) {
      el.appendChild(k);
    } else {
      el.appendChild(document.createTextNode(String(k)));
    }
  }
}

export function svg(paths, size = 24) {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '2');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    el.appendChild(path);
  }
  return el;
}

export const ICONS = {
  today: ['M3 11l9-8 9 8', 'M5 10v10h14V10', 'M10 20v-6h4v6'],
  courses: ['M4 5h16v15H4z', 'M4 10h16', 'M9 5v15', 'M15 5v15'],
  planner: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4 6l1 1 2-2', 'M4 12l1 1 2-2', 'M4 18l1 1 2-2'],
  data: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 19h16'],
  check: ['M5 12l5 5 9-10']
};

let toastTimer = 0;
export function toast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast';
  }, isError ? 4500 : 2200);
}

const layer = () => document.getElementById('layer');

/**
 * 弹层打开时让系统状态栏区域一起「变暗」。
 * iOS 主屏幕 App 的状态栏背景由系统按页面背景色/theme-color 绘制，不在网页内容之内，遮罩盖不到；
 * 所以在弹层存在期间把 theme-color 和根背景换成「米白叠 40% 遮罩」的颜色，收起后还原。
 */
const PAGE_BG = '#F6F1E9';
const DIMMED_BG = '#A5A099';
let openLayers = 0;

function setChromeTint(dim) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', dim ? DIMMED_BG : PAGE_BG);
  }
  document.documentElement.style.backgroundColor = dim ? DIMMED_BG : '';
  document.body.style.backgroundColor = dim ? DIMMED_BG : '';
}

function layerOpened() {
  openLayers += 1;
  if (openLayers === 1) {
    setChromeTint(true);
  }
}

function layerClosing() {
  openLayers = Math.max(0, openLayers - 1);
  if (openLayers === 0) {
    setChromeTint(false);
  }
}

function closeLayer(node) {
  if (node.parentNode !== null) {
    node.parentNode.removeChild(node);
  }
}

/**
 * 底部弹层。返回 { el, close }。
 * onRequestClose 返回 false 可拒绝关闭（例如有未保存内容时先确认）。
 */
export function openSheet({ title, body, foot, onRequestClose }) {
  const scrim = h('div', { class: 'scrim' });
  const grabber = h('div', { class: 'grabber', 'aria-hidden': 'true' });
  const head = h('div', { class: 'sheet-head' },
    h('h2', null, title),
    h('button', { class: 'icon-btn', 'aria-label': '关闭', onClick: () => request() }, '×'));
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, grabber, head);
  const wrapper = h('div', { style: { position: 'absolute', inset: '0' } }, scrim, sheet);
  let closing = false;
  // 先播收起动画再移除节点；动画被系统关闭时也靠定时器兜底移除
  const close = () => {
    if (closing) {
      return;
    }
    closing = true;
    layerClosing();
    wrapper.classList.add('closing');
    setTimeout(() => closeLayer(wrapper), 190);
  };
  const request = async () => {
    if (closing) {
      return true;
    }
    if (onRequestClose) {
      const ok = await onRequestClose();
      if (ok === false) {
        return false;
      }
    }
    close();
    return true;
  };
  scrim.addEventListener('click', request);

  // 抓住顶部把手或标题栏向下拖，超过一定距离就关闭；不够就弹回
  let startY = null;
  let dy = 0;
  const begin = (e) => {
    startY = e.touches[0].clientY;
    dy = 0;
    sheet.style.transition = 'none';
  };
  const move = (e) => {
    if (startY === null) {
      return;
    }
    dy = Math.max(0, e.touches[0].clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
    scrim.style.opacity = String(Math.max(0.2, 1 - dy / 500));
  };
  const end = async () => {
    if (startY === null) {
      return;
    }
    startY = null;
    sheet.style.transition = 'transform .2s ease-out';
    scrim.style.opacity = '';
    if (dy > 90) {
      if (await request()) {
        return;
      }
    }
    sheet.style.transform = '';
  };
  for (const part of [grabber, head]) {
    part.addEventListener('touchstart', begin, { passive: true });
    part.addEventListener('touchmove', move, { passive: true });
    part.addEventListener('touchend', end);
    part.addEventListener('touchcancel', end);
  }

  sheet.appendChild(h('div', { class: 'sheet-body' }, body));
  if (foot) {
    sheet.appendChild(h('div', { class: 'sheet-foot' }, foot));
  }
  layer().appendChild(wrapper);
  layerOpened();
  return { el: sheet, close, request };
}

/** 数字从 0 滚动到 target（倒计时天数等小动效）。动画被关闭或元素已移除时直接落到终值 */
export function countUp(el, target, ms = 600) {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !Number.isFinite(target) || target <= 0) {
    el.textContent = String(target);
    return;
  }
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = String(Math.round(target * eased));
    if (p < 1 && el.isConnected !== false) {
      requestAnimationFrame(step);
    } else {
      el.textContent = String(target);
    }
  };
  el.textContent = '0';
  requestAnimationFrame(step);
}

/** 居中确认框，返回 Promise<boolean> */
export function confirmDialog({ title, message, okText = '确定', danger = false }) {
  return new Promise((resolve) => {
    const scrim = h('div', { class: 'scrim' });
    let finished = false;
    const done = (value) => {
      if (!finished) {
        finished = true;
        layerClosing();
        wrapper.classList.add('closing');
        setTimeout(() => closeLayer(wrapper), 160);
      }
      resolve(value);
    };
    const dialog = h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true' },
      h('h2', null, title),
      h('p', null, message),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onClick: () => done(false) }, '取消'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onClick: () => done(true) }, okText)));
    const wrapper = h('div', { style: { position: 'absolute', inset: '0' } }, scrim, dialog);
    scrim.addEventListener('click', () => done(false));
    layer().appendChild(wrapper);
    layerOpened();
  });
}

export function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 课程名稳定取色（与鸿蒙版 Theme.ets 同一算法，两端颜色一致） */
const PALETTE = ['#2F6F5E', '#D9622B', '#C9962B', '#8A5A44', '#5C7FA3', '#B5527A', '#6B8E3A', '#7B6AA8'];
export function courseColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) % 100000;
  }
  return PALETTE[hash % PALETTE.length];
}

export function urgencyColor(daysLeft) {
  if (daysLeft < 0) {
    return '#9A948B';
  }
  return daysLeft <= 7 ? '#D9622B' : '#3D3A36';
}

export function minutesText(min) {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}
