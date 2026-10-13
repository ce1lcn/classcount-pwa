import { h, openSheet, confirmDialog, urgencyColor } from '../dom.js';
import { ctx, uid } from '../ctx.js';
import { Schedule, calcDaysLeft, startOfDay } from '../logic/schedule.js';
import {
  TodoDraft, dayOf, dateOfDay, dayLabel, parseDay, starsText, ruleLabel, draftError, createTodo,
  editTodo, completeTodo as completeTodoLogic, reconcile, pendingTodos, saveDiary, clonePlanner
} from '../logic/planner.js';

const WEEKDAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'];
const REPEATS = [['once', '单次'], ['daily', '每天'], ['weekly', '每周'], ['interval', '每隔 N 天']];

const ui = {
  seg: 'todo',
  showFuture: false,
  historyLimit: 50,
  diaryDay: dayOf(new Date()),
  /** null 表示尚未从数据加载 */
  diaryBody: null,
  diarySaved: ''
};

// ---------------------------------------------------------------- 待办操作

export function completeTodo(todo) {
  const next = clonePlanner(ctx.state.planner);
  const today = dayOf(new Date());
  if (completeTodoLogic(next, todo.id, today)) {
    ctx.commitPlanner(next, '已完成，记录已保存在历史中');
  }
}

async function removeTodo(todo) {
  if (!await confirmDialog({
    title: '删除待办？', message: `删除「${todo.title}」后不再出现，已有历史记录仍会保留。`, okText: '删除', danger: true
  })) {
    return false;
  }
  const next = clonePlanner(ctx.state.planner);
  reconcile(next, dayOf(new Date()));
  next.todos = next.todos.filter((item) => item.id !== todo.id);
  return ctx.commitPlanner(next, '待办已删除，历史已保留');
}

// ---------------------------------------------------------------- 待办编辑器

export function openTodoEditor(todo) {
  const v = {
    title: todo ? todo.title : '',
    note: todo ? todo.note : '',
    stars: todo ? todo.stars : 3,
    repeat: todo ? todo.repeat : 'once',
    weekdays: todo ? todo.weekdays.slice() : [],
    interval: todo ? String(todo.interval) : '2',
    date: todo ? dayLabel(todo.startDay) : dayLabel(dayOf(new Date()))
  };
  const signature = () => JSON.stringify([v.title, v.note, v.stars, v.repeat, v.weekdays.slice().sort(), v.interval, v.date]);
  const baseline = signature();
  const errorBox = h('div', { class: 'form-error' });
  const dynamic = h('div');

  const titleInput = h('input', {
    class: 'input', type: 'text', maxlength: '80', placeholder: '要做什么', value: v.title,
    onInput: (e) => { v.title = e.target.value; }
  });
  const noteInput = h('textarea', {
    class: 'textarea', maxlength: '2000', placeholder: '补充说明（选填）',
    onInput: (e) => { v.note = e.target.value; }
  });
  noteInput.value = v.note;

  const renderDynamic = () => {
    dynamic.replaceChildren(...[
      h('div', { class: 'field' }, h('div', { class: 'label' }, '重要程度'),
        h('div', { class: 'chips' }, [1, 2, 3, 4, 5].map((n) => h('button', {
          class: 'chip', 'aria-pressed': v.stars === n, onClick: () => { v.stars = n; renderDynamic(); }
        }, `${n} 星`)))),
      h('div', { class: 'field' }, h('div', { class: 'label' }, '执行方式'),
        h('div', { class: 'chips' }, REPEATS.map(([key, label]) => h('button', {
          class: 'chip', 'aria-pressed': v.repeat === key, onClick: () => { v.repeat = key; renderDynamic(); }
        }, label)))),
      v.repeat === 'weekly' ? h('div', { class: 'field' }, h('div', { class: 'label' }, '每周几'),
        h('div', { class: 'chips' }, WEEKDAY_NAMES.map((name, i) => h('button', {
          class: 'chip', 'aria-pressed': v.weekdays.indexOf(i + 1) >= 0,
          onClick: () => {
            const day = i + 1;
            v.weekdays = v.weekdays.indexOf(day) >= 0 ? v.weekdays.filter((d) => d !== day) : v.weekdays.concat([day]);
            renderDynamic();
          }
        }, name)))) : null,
      v.repeat === 'interval' ? h('div', { class: 'field' }, h('label', null, '间隔天数（1～365）'),
        h('input', {
          class: 'input', type: 'number', inputmode: 'numeric', min: '1', max: '365', value: v.interval,
          onInput: (e) => { v.interval = e.target.value; }
        })) : null,
      h('div', { class: 'field' },
        h('label', null, v.repeat === 'once' ? '日期' : '从哪天开始'),
        h('input', {
          class: 'input', type: 'date', value: v.date,
          onInput: (e) => { v.date = e.target.value; }
        }))].filter((node) => node !== null));
  };
  renderDynamic();

  const sheet = openSheet({
    title: todo ? '编辑待办' : '新增待办',
    body: [
      h('div', { class: 'field', style: { marginTop: '4px' } }, h('label', null, '名称'), titleInput),
      h('div', { class: 'field' }, h('label', null, '说明'), noteInput),
      dynamic,
      errorBox
    ],
    foot: [
      todo ? h('button', {
        class: 'btn danger',
        onClick: async () => {
          if (await removeTodo(todo)) {
            sheet.close();
          }
        }
      }, '删除') : null,
      h('button', { class: 'btn', onClick: () => sheet.request() }, '取消'),
      h('button', {
        class: 'btn primary',
        onClick: () => {
          const draft = new TodoDraft();
          draft.title = v.title;
          draft.note = v.note;
          draft.stars = v.stars;
          draft.repeat = v.repeat;
          draft.startDay = parseDay(v.date);
          draft.weekdays = v.weekdays.slice();
          draft.interval = v.repeat === 'interval' ? Number(v.interval) : 2;
          const message = draftError(draft);
          if (message.length > 0) {
            errorBox.textContent = message;
            return;
          }
          const next = clonePlanner(ctx.state.planner);
          const today = dayOf(new Date());
          try {
            if (todo) {
              editTodo(next, todo.id, draft, today);
            } else {
              next.todos.push(createTodo(draft, uid()));
            }
            reconcile(next, today);
          } catch (err) {
            errorBox.textContent = err.message;
            return;
          }
          if (ctx.commitPlanner(next, '待办已保存')) {
            if (pendingTodos(next, today, true).length > 0) {
              ui.showFuture = true;
            }
            sheet.close();
          }
        }
      }, '保存')
    ],
    onRequestClose: async () => {
      if (signature() === baseline) {
        return true;
      }
      return confirmDialog({ title: '放弃本次编辑？', message: '尚未保存的修改将被放弃。', okText: '放弃', danger: true });
    }
  });
}

// ---------------------------------------------------------------- 日程编辑器

export function openScheduleEditor(item) {
  const v = {
    title: item ? item.title : '',
    note: item ? item.note : '',
    date: item ? dayLabel(dayOf(new Date(item.targetDate))) : dayLabel(dayOf(new Date()) + 7)
  };
  const baseline = JSON.stringify(v);
  const errorBox = h('div', { class: 'form-error' });
  const noteInput = h('textarea', {
    class: 'textarea', maxlength: '500', placeholder: '备注（选填）', onInput: (e) => { v.note = e.target.value; }
  });
  noteInput.value = v.note;

  const sheet = openSheet({
    title: item ? '编辑日程' : '新增日程',
    body: [
      h('div', { class: 'field', style: { marginTop: '4px' } }, h('label', null, '日程名称'),
        h('input', {
          class: 'input', type: 'text', maxlength: '40', placeholder: '如：期末考试', value: v.title,
          onInput: (e) => { v.title = e.target.value; }
        })),
      h('div', { class: 'field' }, h('label', null, '目标日期'),
        h('input', { class: 'input', type: 'date', value: v.date, onInput: (e) => { v.date = e.target.value; } })),
      h('div', { class: 'field' }, h('label', null, '备注'), noteInput),
      errorBox
    ],
    foot: [
      item ? h('button', {
        class: 'btn danger',
        onClick: async () => {
          if (!await confirmDialog({
            title: '删除日程？', message: `确定删除「${item.title}」？待办与日记会继续保留。`, okText: '删除', danger: true
          })) {
            return;
          }
          const list = ctx.state.schedules.filter((s) => s.id !== item.id);
          const active = ctx.state.activeId === item.id ? (list.length > 0 ? list[0].id : '') : ctx.state.activeId;
          if (ctx.commitSchedules(list, active, '日程已删除')) {
            sheet.close();
          }
        }
      }, '删除') : null,
      h('button', { class: 'btn', onClick: () => sheet.request() }, '取消'),
      h('button', {
        class: 'btn primary',
        onClick: () => {
          const title = v.title.trim();
          if (title.length === 0) {
            errorBox.textContent = '请输入日程名称';
            return;
          }
          const day = parseDay(v.date);
          if (day < 0) {
            errorBox.textContent = '请选择有效的目标日期';
            return;
          }
          const target = startOfDay(dateOfDay(day).getTime());
          const list = ctx.state.schedules.slice();
          let active = ctx.state.activeId;
          const index = item ? list.findIndex((s) => s.id === item.id) : -1;
          if (index >= 0) {
            list[index] = new Schedule(item.id, title, target, item.createdDate, v.note);
          } else {
            active = uid();
            list.push(new Schedule(active, title, target, startOfDay(Date.now()), v.note));
          }
          list.sort((a, b) => a.targetDate - b.targetDate);
          if (ctx.commitSchedules(list, active, '日程已保存')) {
            sheet.close();
          }
        }
      }, '保存')
    ],
    onRequestClose: async () => {
      if (JSON.stringify(v) === baseline) {
        return true;
      }
      return confirmDialog({ title: '放弃本次编辑？', message: '尚未保存的修改将被放弃。', okText: '放弃', danger: true });
    }
  });
}

// ---------------------------------------------------------------- 日记

function ensureDiary() {
  if (ui.diaryBody === null) {
    loadDiary(ui.diaryDay);
  }
}

function loadDiary(day) {
  const entry = ctx.state.planner.diaries.find((d) => d.day === day);
  ui.diaryDay = day;
  ui.diaryBody = entry === undefined ? '' : entry.body;
  ui.diarySaved = ui.diaryBody;
}

function diaryDirty() {
  return ui.diaryBody !== null && ui.diaryBody !== ui.diarySaved;
}

function persistDiary(message = '日记已保存') {
  const next = clonePlanner(ctx.state.planner);
  saveDiary(next, ui.diaryDay, ui.diaryBody, Date.now());
  if (ctx.commitPlanner(next, message, false)) {
    ui.diarySaved = ui.diaryBody;
    return true;
  }
  return false;
}

/** 切换日期/标签前自动保存未保存的日记，避免丢字；保存失败返回 false 以阻止离开 */
export function flushDiaryIfDirty() {
  if (!diaryDirty()) {
    return true;
  }
  return persistDiary('日记已自动保存');
}

// ---------------------------------------------------------------- 视图

function dueLabel(todo, today) {
  const days = today - todo.nextDay;
  if (days > 0) {
    return `${todo.repeat === 'once' ? '已逾期' : '已连续'} ${days} 天${todo.repeat === 'once' ? '' : '未完成'} · 原定 ${dayLabel(todo.nextDay)}`;
  }
  return days === 0 ? '今天要做' : `${dayLabel(todo.nextDay)} 开始`;
}

function todoCard(todo, today) {
  const actionable = todo.nextDay <= today;
  return h('div', { class: 'card todo' },
    h('button', {
      class: `check${actionable ? '' : ' disabled'}`, 'aria-label': `完成：${todo.title}`,
      disabled: !actionable, onClick: () => completeTodo(todo)
    }),
    h('button', { class: 'row-btn grow', onClick: () => openTodoEditor(todo) },
      h('div', { class: 'title' }, todo.title),
      todo.note.length > 0 ? h('div', { class: 'muted small ellipsis' }, todo.note) : null,
      h('div', { class: `due${todo.nextDay < today ? ' late' : ''}` },
        h('span', { class: 'stars' }, starsText(todo.stars)), ` · ${ruleLabel(todo)}`),
      h('div', { class: `due${todo.nextDay < today ? ' late' : ''}` }, dueLabel(todo, today))));
}

function todoSegment(today) {
  const data = ctx.state.planner;
  const due = pendingTodos(data, today, false);
  const future = pendingTodos(data, today, true);
  return [
    h('div', { class: 'list' }, due.length > 0 ? due.map((t) => todoCard(t, today))
      : [h('div', { class: 'card empty' }, '今天没有要做的待办')]),
    future.length > 0 ? h('div', { class: 'section-title' },
      h('span', null, `即将开始（${future.length}）`),
      h('button', { class: 'btn small', onClick: () => { ui.showFuture = !ui.showFuture; ctx.rerender(); } },
        ui.showFuture ? '收起' : '展开')) : null,
    ui.showFuture ? h('div', { class: 'list' }, future.map((t) => todoCard(t, today))) : null,
    h('button', { class: 'fab', 'aria-label': '新增待办', onClick: () => openTodoEditor(null) }, '+')
  ];
}

function scheduleSegment() {
  const now = Date.now();
  const list = ctx.state.schedules.slice().sort((a, b) => a.targetDate - b.targetDate);
  return [
    h('div', { class: 'list' }, list.length > 0 ? list.map((item) => {
      const left = calcDaysLeft(item.targetDate, now);
      return h('button', { class: 'row-btn', onClick: () => openScheduleEditor(item) },
        h('div', { class: 'card todo' },
          h('div', {
            style: { width: '6px', alignSelf: 'stretch', borderRadius: '3px', background: urgencyColor(left), flex: 'none' }
          }),
          h('div', { class: 'grow' },
            h('div', { class: 'title ellipsis' }, item.title),
            h('div', { class: 'due' }, dayLabel(dayOf(new Date(item.targetDate))))),
          h('div', { style: { textAlign: 'right', fontWeight: '700' } },
            left > 0 ? `${left} 天` : (left === 0 ? '今天' : `已过 ${-left} 天`))));
    }) : [h('div', { class: 'card empty' }, '还没有日程')]),
    h('button', { class: 'fab', 'aria-label': '新增日程', onClick: () => openScheduleEditor(null) }, '+')
  ];
}

function historySegment() {
  const rows = ctx.state.planner.history.slice()
    .sort((a, b) => b.recordedDay - a.recordedDay || b.id.localeCompare(a.id));
  if (rows.length === 0) {
    return [h('div', { class: 'card empty' }, '还没有记录。完成待办或错过日期后，会在这里留下痕迹。')];
  }
  return [
    h('div', { class: 'list' }, rows.slice(0, ui.historyLimit).map((r) => h('div', { class: 'card history-row' },
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        h('span', { class: `tag ${r.status === 'completed' ? 'done' : 'miss'}` }, r.status === 'completed' ? '已完成' : '未完成'),
        h('span', { class: 'title ellipsis grow' }, r.title),
        h('span', { class: 'stars' }, starsText(r.stars))),
      h('div', { class: 'muted small', style: { marginTop: '4px' } },
        `${r.rule} · 原定 ${dayLabel(r.dueDay)}${r.overdueDays > 0 ? ` · 晚了 ${r.overdueDays} 天` : ''} · 记于 ${dayLabel(r.recordedDay)}`)))),
    rows.length > ui.historyLimit ? h('div', { style: { marginTop: '12px' } },
      h('button', { class: 'btn block', onClick: () => { ui.historyLimit += 50; ctx.rerender(); } },
        `显示更多（还有 ${rows.length - ui.historyLimit} 条）`)) : null
  ];
}

function diarySegment(today) {
  ensureDiary();
  const diaries = ctx.state.planner.diaries.filter((d) => d.body.trim().length > 0)
    .sort((a, b) => b.day - a.day);
  const go = (day) => {
    if (!flushDiaryIfDirty()) {
      return;
    }
    loadDiary(day);
    ctx.rerender();
  };
  const area = h('textarea', {
    class: 'textarea tall', placeholder: '写点什么吧……', 'aria-label': `${dayLabel(ui.diaryDay)} 的日记`,
    onInput: (e) => { ui.diaryBody = e.target.value; },
    onBlur: () => { flushDiaryIfDirty(); }
  });
  area.value = ui.diaryBody;
  return [
    h('div', { class: 'diary-nav' },
      h('button', { class: 'icon-btn', 'aria-label': '前一天', onClick: () => go(ui.diaryDay - 1) }, '‹'),
      h('div', { class: 'mid' }, dayLabel(ui.diaryDay), ui.diaryDay === today ? '（今天）' : ''),
      h('button', { class: 'icon-btn', 'aria-label': '后一天', onClick: () => go(ui.diaryDay + 1) }, '›')),
    area,
    h('div', { style: { display: 'flex', gap: '10px', marginTop: '10px' } },
      ui.diaryDay !== today ? h('button', { class: 'btn', onClick: () => go(today) }, '回到今天') : null,
      h('button', { class: 'btn primary grow', onClick: () => { if (persistDiary()) { ctx.rerender(); } } }, '保存日记')),
    diaries.length > 0 ? h('div', { class: 'section-title' }, h('span', null, '写过的日子')) : null,
    h('div', { class: 'list' }, diaries.slice(0, 30).map((d) => h('button', {
      class: 'row-btn', onClick: () => go(d.day)
    }, h('div', { class: 'card history-row' },
      h('div', { class: 'title' }, dayLabel(d.day)),
      h('div', { class: 'muted small ellipsis' }, d.body.trim().split('\n')[0])))))
  ];
}

export function renderPlanner() {
  const today = dayOf(new Date());
  const segs = [['todo', '待办'], ['schedule', '日程'], ['diary', '日记'], ['history', '记录']];
  let content;
  if (ui.seg === 'schedule') {
    content = scheduleSegment();
  } else if (ui.seg === 'diary') {
    content = diarySegment(today);
  } else if (ui.seg === 'history') {
    content = historySegment();
  } else {
    content = todoSegment(today);
  }
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', null, h('h1', { class: 'page-title' }, '手账'),
        h('div', { class: 'page-sub' }, '待办、日程与每日记录'))),
    h('div', { class: 'segment', role: 'tablist' }, segs.map(([key, label]) => h('button', {
      role: 'tab', 'aria-selected': ui.seg === key,
      onClick: () => {
        if (!flushDiaryIfDirty()) {
          return;
        }
        ui.seg = key;
        ctx.rerender();
      }
    }, label))),
    content);
}

export function notifyDataReplaced() {
  ui.diaryBody = null;
  ui.diaryDay = dayOf(new Date());
}

