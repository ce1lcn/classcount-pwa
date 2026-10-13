import { h, courseColor, urgencyColor, minutesText } from '../dom.js';
import { ctx } from '../ctx.js';
import {
  calcNextClass, todayClasses, weekOfTerm, sectionStartTime, sectionEndTime
} from '../logic/course.js';
import { calcDaysLeft, calcProgressPercent } from '../logic/schedule.js';
import { pendingTodos, starsText, dayOf, dayLabel } from '../logic/planner.js';
import { openScheduleEditor, completeTodo, openTodoEditor } from './planner.js';

const WEEK_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

function weekText(now) {
  const t = ctx.state.course;
  if (t.termStart <= 0) {
    return '未设置开学日';
  }
  const w = weekOfTerm(t, now);
  if (w < 1) {
    return '尚未开学';
  }
  return `第 ${w} 周`;
}

function nextCard(now) {
  const course = ctx.state.course;
  if (course.items.length === 0) {
    return h('div', { class: 'next-card empty-card' },
      h('div', { class: 'name' }, '还没有课表'),
      h('div', { class: 'meta muted' }, '到「数据」页导入课表文件，之后这里会显示下一节课。'),
      h('div', { style: { marginTop: '12px' } },
        h('button', { class: 'btn soft', onClick: () => ctx.setTab('data') }, '去导入')));
  }
  if (course.termStart <= 0) {
    return h('div', { class: 'next-card empty-card' },
      h('div', { class: 'name' }, '还差开学日'),
      h('div', { class: 'meta muted' }, '课表按周次排课，设置学期第 1 周的周一后才能算出今天是第几周。'),
      h('div', { style: { marginTop: '12px' } },
        h('button', { class: 'btn soft', onClick: () => ctx.setTab('courses') }, '去设置')));
  }
  const next = calcNextClass(course, now);
  if (!next.hasClass) {
    return h('div', { class: 'next-card empty-card' },
      h('div', { class: 'name' }, '近期没有课了'),
      h('div', { class: 'meta muted' }, '本学期的课已经全部结束，或之后没有排课。'));
  }
  return h('div', { class: 'next-card' },
    h('div', { class: 'label' },
      h('span', null, next.ongoing ? '正在上课' : `下一节 · ${next.whenText}`),
      h('span', { class: 'pill' }, next.countdownText)),
    h('div', { class: 'name' }, next.name),
    h('div', { class: 'meta' }, `${next.roomText} · ${next.sectionText}`),
    next.teacher.length > 0 ? h('div', { class: 'meta' }, next.teacher) : null);
}

function courseRows(now) {
  const list = todayClasses(ctx.state.course, now);
  if (list.length === 0) {
    return [h('div', { class: 'card empty' }, ctx.state.course.items.length === 0 ? '暂无课程' : '今天没有课')];
  }
  const d = new Date(now);
  const minute = d.getHours() * 60 + d.getMinutes();
  return list.map((it) => {
    const start = sectionStartTime(it.startSection);
    const end = sectionEndTime(it.endSection);
    const cls = end <= minute ? ' past' : (start <= minute ? ' now' : '');
    return h('div', { class: `card course-row${cls}` },
      h('div', { class: 'bar', style: { background: courseColor(it.name) } }),
      h('div', { class: 'time' }, minutesText(start), h('br'), minutesText(end)),
      h('div', { class: 'grow' },
        h('div', { class: 'title ellipsis' }, it.name),
        h('div', { class: 'muted small' },
          `${it.room.length > 0 ? it.room : '待定'} · 第 ${it.startSection}-${it.endSection} 节`)));
  });
}

function scheduleCards(now) {
  const list = ctx.state.schedules.slice().sort((a, b) => {
    const da = calcDaysLeft(a.targetDate, now);
    const db = calcDaysLeft(b.targetDate, now);
    if ((da < 0) !== (db < 0)) {
      return da < 0 ? 1 : -1;
    }
    return a.targetDate - b.targetDate;
  });
  if (list.length === 0) {
    return [h('div', { class: 'card empty' }, '还没有日程，点右上「＋ 日程」创建第一个倒计时')];
  }
  return list.map((item) => {
    const left = calcDaysLeft(item.targetDate, now);
    const percent = calcProgressPercent(item.createdDate, item.targetDate, now);
    const text = left > 0 ? `${left}` : (left === 0 ? '今天' : `${-left}`);
    const unit = left > 0 ? '天' : (left === 0 ? '' : '天前');
    return h('button', {
      class: 'row-btn', 'aria-label': `编辑日程：${item.title}`, onClick: () => openScheduleEditor(item)
    },
    h('div', { class: 'sched', style: { background: urgencyColor(left) } },
      h('div', { class: 'grow' },
        h('div', { class: 'title ellipsis' }, item.title),
        h('div', { class: 'date' }, dayLabel(dayOf(new Date(item.targetDate)))),
        h('div', { class: 'progress' }, h('i', { style: { width: `${percent}%` } }))),
      h('div', { class: 'days' }, h('b', null, text), h('span', null, unit))));
  });
}

function todoRows(today) {
  const list = pendingTodos(ctx.state.planner, today, false);
  if (list.length === 0) {
    return [h('div', { class: 'card empty' }, '今天没有待办')];
  }
  return list.slice(0, 6).map((todo) => {
    const late = todo.nextDay < today;
    return h('div', { class: 'card todo' },
      h('button', {
        class: 'check', 'aria-label': `完成：${todo.title}`, onClick: () => completeTodo(todo)
      }),
      h('button', { class: 'row-btn grow', onClick: () => openTodoEditor(todo) },
        h('div', { class: 'title ellipsis' }, todo.title),
        h('div', { class: `due${late ? ' late' : ''}` },
          h('span', { class: 'stars' }, starsText(todo.stars)),
          late ? ` · 逾期 ${today - todo.nextDay} 天` : '')));
  });
}

export function renderToday() {
  const now = Date.now();
  const today = dayOf(new Date(now));
  const d = new Date(now);
  const more = pendingTodos(ctx.state.planner, today, false).length - 6;
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', null,
        h('h1', { class: 'page-title' }, `${d.getMonth() + 1}月${d.getDate()}日`),
        h('div', { class: 'page-sub' }, `周${WEEK_NAMES[d.getDay()]} · ${weekText(now)}`)),
      h('button', { class: 'btn small soft', onClick: () => openScheduleEditor(null) }, '＋ 日程')),
    nextCard(now),
    h('div', { class: 'section-title' }, h('span', null, '今日课程'),
      h('span', { class: 'small' }, `${todayClasses(ctx.state.course, now).length} 门`)),
    h('div', { class: 'list' }, courseRows(now)),
    h('div', { class: 'section-title' }, h('span', null, '日程倒计时')),
    h('div', { class: 'list' }, scheduleCards(now)),
    h('div', { class: 'section-title' }, h('span', null, '待办'),
      h('button', { class: 'btn small', onClick: () => ctx.setTab('planner') }, '全部待办')),
    h('div', { class: 'list' }, todoRows(today)),
    more > 0 ? h('div', { class: 'hint' }, `还有 ${more} 项，到「手账」查看`) : null,
    h('div', { style: { height: '8px' } }));
}
