import { h, svg, ICONS, toast } from './dom.js';
import { ctx } from './ctx.js';
import { Store, emptyState } from './store.js';
import { reconcile, dayOf, clonePlanner } from './logic/planner.js';
import { renderToday } from './views/today.js';
import { renderCourses, resetCoursesView } from './views/courses.js';
import { renderPlanner, flushDiaryIfDirty, notifyDataReplaced } from './views/planner.js';
import { renderData } from './views/data.js';

const TABS = [
  ['today', '今天', ICONS.today],
  ['courses', '课表', ICONS.courses],
  ['planner', '手账', ICONS.planner],
  ['data', '数据', ICONS.data]
];

let persisted = null;
let renderedTab = '';

/** localStorage 在隐私模式等场景可能不可用，退化为仅内存并在数据页提示 */
function createStorage() {
  try {
    const s = window.localStorage;
    const probe = 'classcount.probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return { storage: s, memoryOnly: false };
  } catch (err) {
    const map = new Map();
    return {
      memoryOnly: true,
      storage: {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); }
      }
    };
  }
}

function pageFor(tab) {
  if (tab === 'courses') {
    return renderCourses();
  }
  if (tab === 'planner') {
    return renderPlanner();
  }
  if (tab === 'data') {
    return renderData({ persisted });
  }
  return renderToday();
}

function render() {
  const main = document.getElementById('main');
  // 只有「切换了标签」才播放进入动画；数据刷新、每分钟重绘都不播，避免闪烁
  const entering = renderedTab !== ctx.tab;
  const fromIndex = TABS.findIndex(([key]) => key === renderedTab);
  const toIndex = TABS.findIndex(([key]) => key === ctx.tab);
  ctx.entering = entering;
  const keep = entering ? 0 : main.scrollTop;
  let page;
  try {
    page = pageFor(ctx.tab);
  } catch (err) {
    console.error(err);
    page = h('div', { class: 'page' },
      h('div', { class: 'banner error' }, `页面出错了：${err.message}`),
      h('button', { class: 'btn block', onClick: () => ctx.setTab('data') }, '去「数据」页导出备份'));
  }
  if (entering) {
    page.classList.add('enter');
    if (fromIndex >= 0) {
      page.classList.add(toIndex > fromIndex ? 'from-right' : 'from-left');
    }
  }
  const problems = ctx.tab === 'data' ? [] : ctx.store.problems();
  const parts = [];
  if (problems.length > 0) {
    parts.push(h('div', { class: 'page' },
      h('div', { class: 'banner error' }, '有数据读取异常，已阻止覆盖保存。请到「数据」页处理。')));
  }
  parts.push(page);
  main.classList.toggle('fit', page.classList.contains('fit'));
  main.replaceChildren(...parts);
  main.scrollTop = keep;
  renderedTab = ctx.tab;
  renderTabs(entering);
}

function renderTabs(pop) {
  document.getElementById('tabs').replaceChildren(...TABS.map(([key, label, icon]) => {
    const current = ctx.tab === key;
    const button = h('button', {
      class: 'tab', 'aria-current': current ? 'page' : null, onClick: () => ctx.setTab(key)
    }, svg(icon), label);
    if (current && pop) {
      button.classList.add('pop');
    }
    return button;
  }));
}

function guarded(write, message, rerender = true) {
  try {
    write();
  } catch (err) {
    toast(err.message, true);
    return false;
  }
  if (message) {
    toast(message);
  }
  if (rerender) {
    render();
  }
  return true;
}

function wire() {
  ctx.setTab = (tab) => {
    if (tab === ctx.tab) {
      return;
    }
    if (!flushDiaryIfDirty()) {
      return;
    }
    ctx.tab = tab;
    render();
  };
  ctx.rerender = render;
  ctx.commitCourse = (table, message) => guarded(() => {
    ctx.store.saveCourse(table);
    ctx.state.course = table;
  }, message);
  ctx.commitSchedules = (list, activeId, message) => guarded(() => {
    ctx.store.saveSchedules(list, activeId);
    ctx.state.schedules = list;
    ctx.state.activeId = activeId;
  }, message);
  ctx.commitPlanner = (next, message, rerender = true) => guarded(() => {
    ctx.store.savePlanner(next);
    ctx.state.planner = next;
  }, message, rerender);
  ctx.replaceAll = (incoming) => guarded(() => {
    const planner = incoming.planner;
    reconcile(planner, dayOf(new Date()));
    ctx.store.replaceAll(incoming);
    ctx.state = incoming;
    resetCoursesView();
    notifyDataReplaced();
  }, '备份已导入');
  ctx.clearAll = () => guarded(() => {
    ctx.store.clearAll();
    ctx.state = emptyState();
    resetCoursesView();
    notifyDataReplaced();
  }, '已清除全部数据');
}

function startClock() {
  let lastDay = dayOf(new Date());
  let lastMinute = Math.floor(Date.now() / 60000);
  const tick = () => {
    const today = dayOf(new Date());
    const minute = Math.floor(Date.now() / 60000);
    if (today !== lastDay) {
      lastDay = today;
      const next = clonePlanner(ctx.state.planner);
      if (reconcile(next, today)) {
        try {
          ctx.store.savePlanner(next);
          ctx.state.planner = next;
        } catch (err) {
          toast(err.message, true);
        }
      }
      render();
    } else if (minute !== lastMinute) {
      lastMinute = minute;
      if (ctx.tab === 'today') {
        render();
      }
    }
  };
  setInterval(tick, 20000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      tick();
      if (ctx.tab === 'today') {
        render();
      }
    }
  });
}

function boot() {
  const { storage, memoryOnly } = createStorage();
  ctx.store = new Store(storage);
  ctx.memoryOnly = memoryOnly;
  ctx.state = ctx.store.load();
  wire();
  try {
    if (reconcile(ctx.state.planner, dayOf(new Date()))) {
      ctx.store.savePlanner(ctx.state.planner);
    }
  } catch (err) {
    toast(err.message, true);
  }
  render();
  startClock();

  // 键盘收起后 iOS 有时会把整个页面留在被顶起的位置，失焦时复位
  document.addEventListener('focusout', () => {
    setTimeout(() => window.scrollTo(0, 0), 60);
  });
  // 切到后台或被系统回收前，把没点「保存」的日记落盘，避免丢字
  const flushOnLeave = () => {
    flushDiaryIfDirty();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushOnLeave();
    }
  });
  window.addEventListener('pagehide', flushOnLeave);

  window.addEventListener('error', (e) => toast(`出错了：${e.message}`, true));
  window.addEventListener('unhandledrejection', (e) => toast(`出错了：${e.reason && e.reason.message ? e.reason.message : e.reason}`, true));

  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then((ok) => {
      persisted = ok;
      if (ctx.tab === 'data') {
        render();
      }
    }).catch(() => {});
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = navigator.serviceWorker.controller !== null;
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('service worker 注册失败', err));
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) {
        toast('已更新到新版本，重新打开后生效');
      }
    });
  }
}

boot();
