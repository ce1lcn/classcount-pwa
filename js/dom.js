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
        if (name.startsWith('--')) {
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
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const wrapper = h('div', { style: { position: 'absolute', inset: '0' } }, scrim, sheet);
  const close = () => closeLayer(wrapper);
  const request = async () => {
    if (onRequestClose) {
      const ok = await onRequestClose();
      if (ok === false) {
        return;
      }
    }
    close();
  };
  scrim.addEventListener('click', request);
  sheet.appendChild(h('div', { class: 'sheet-head' },
    h('h2', null, title),
    h('button', { class: 'icon-btn', 'aria-label': '关闭', onClick: request }, '×')));
  sheet.appendChild(h('div', { class: 'sheet-body' }, body));
  if (foot) {
    sheet.appendChild(h('div', { class: 'sheet-foot' }, foot));
  }
  layer().appendChild(wrapper);
  return { el: sheet, close, request };
}

/** 居中确认框，返回 Promise<boolean> */
export function confirmDialog({ title, message, okText = '确定', danger = false }) {
  return new Promise((resolve) => {
    const scrim = h('div', { class: 'scrim' });
    const done = (value) => {
      closeLayer(wrapper);
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
