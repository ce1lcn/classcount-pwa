import { h, svg, ICONS, countUp, courseColor, urgencyColor, minutesText } from '../dom.js';
import { ctx } from '../ctx.js';
import {
  calcNextClass, todayClasses, weekOfTerm, startOfToday, startOfWeek, sectionStartTime, sectionEndTime
} from '../logic/course.js';
import { calcDaysLeft, calcProgressPercent } from '../logic/schedule.js';
import { pendingTodos, starsText, dayOf, dayLabel } from '../logic/planner.js';
import { openScheduleEditor, completeTodo, openTodoEditor, showSegment } from './planner.js';
import { openCourseDetail, openDaySheet, showCourse } from './courses.js';

const WEEK_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
const DAY_CHARS = ['一', '二', '三', '四', '五', '六', '日'];

function greeting(hour) {
  if (hour < 5) {
    return '夜深了';
  }
  if (hour < 11) {
    return '早上好';
  }
  if (hour < 14) {
    return '中午好';
  }
  if (hour < 18) {
    return '下午好';
  }
  return '晚上好';
}

function currentWeekNumber(now) {
  const t = ctx.state.course;
  return t.termStart > 0 ? weekOfTerm(t, now) : 0;
}

function weekText(now) {
  const t = ctx.state.course;
  if (t.termStart <= 0) {
    return '未设置开学日';
  }
  const w = currentWeekNumber(now);
  return w < 1 ? '尚未开学' : `第 ${w} 周`;
}

/** 找出「下一节课」对应的课程格和周次，供点击跳转用 */
function findNextItem(next, course) {
  const week = weekOfTerm(course, next.startAt);
  const dow = ((new Date(next.startAt).getDay() + 6) % 7) + 1;
  const dayStart = startOfToday(next.startAt);
  const item = course.items.find((it) => it.name === next.name && it.dayOfWeek === dow &&
    it.weekList.indexOf(week) >= 0 && dayStart + sectionStartTime(it.startSection) * 60000 === next.startAt);
  return item === undefined ? null : { item, week };
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
  const target = findNextItem(next, course);
  const elapsed = next.ongoing ? Math.min(1, Math.max(0, (now - next.startAt) / (next.endAt - next.startAt))) : 0;
  const card = h('div', { class: 'next-card' },
    h('div', { class: 'label' },
      h('span', null, next.ongoing ? h('span', null, h('i', { class: 'live-dot' }), '正在上课') : `下一节 · ${next.whenText}`),
      h('span', { class: 'pill' }, next.countdownText)),
    h('div', { class: 'name' }, next.name),
    h('div', { class: 'meta' }, `${next.roomText} · ${next.sectionText}`),
    next.teacher.length > 0 ? h('div', { class: 'meta' }, next.teacher) : null,
    next.ongoing ? h('div', { class: 'class-progress', 'aria-hidden': 'true' },
      h('i', { style: { width: `${Math.round(elapsed * 100)}%` } })) : null);
  if (target === null) {
    return card;
  }
  return h('button', {
    class: 'row-btn', 'aria-label': `查看课程：${next.name}`, onClick: () => showCourse(target.item, target.week)
  }, card);
}

function weekStrip(now) {
  const course = ctx.state.course;
  const week = currentWeekNumber(now);
  if (course.items.length === 0 || week < 1) {
    return null;
  }
  const monday = startOfWeek(now);
  const todayDow = ((new Date(now).getDay() + 6) % 7) + 1;
  const cells = [];
  for (let dow = 1; dow <= 7; dow++) {
    const date = new Date(monday);
    date.setDate(date.getDate() + dow - 1);
    const has = course.items.some((it) => it.dayOfWeek === dow && it.weekList.indexOf(week) >= 0);
    cells.push(h('button', {
      class: `${dow === todayDow ? 'today' : ''}${has ? ' has' : ''}`.trim(),
      'aria-label': `周${DAY_CHARS[dow - 1]} ${date.getMonth() + 1}月${date.getDate()}日${has ? '，有课' : '，没课'}`,
      onClick: () => openDaySheet(week, dow)
    }, DAY_CHARS[dow - 1], h('b', null, String(date.getDate())), h('i')));
  }
  return h('div', { class: 'week-strip' }, cells);
}

function courseRows(now) {
  const list = todayClasses(ctx.state.course, now);
  if (list.length === 0) {
    const none = ctx.state.course.items.length === 0;
    return [h('div', { class: 'card empty' }, none ? '暂无课程' : '今天没有课，留给自己一点时间')];
  }
  const week = currentWeekNumber(now);
  const d = new Date(now);
  const minute = d.getHours() * 60 + d.getMinutes();
  return list.map((it) => {
    const start = sectionStartTime(it.startSection);
    const end = sectionEndTime(it.endSection);
    const cls = end <= minute ? ' past' : (start <= minute ? ' now' : '');
    return h('button', {
      class: 'row-btn', 'aria-label': `查看课程：${it.name}`, onClick: () => openCourseDetail(it, week)
    }, h('div', { class: `card course-row${cls}` },
      h('div', { class: 'bar', style: { background: courseColor(it.name) } }),
      h('div', { class: 'time' }, minutesText(start), h('br'), minutesText(end)),
      h('div', { class: 'grow' },
        h('div', { class: 'title ellipsis' }, it.name),
        h('div', { class: 'muted small' },
          `${it.room.length > 0 ? it.room : '待定'} · 第 ${it.startSection}-${it.endSection} 节`))));
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
    const number = h('b', null, left > 0 ? String(left) : (left === 0 ? '今天' : String(-left)));
    if (left > 0 && ctx.entering) {
      countUp(number, left);
    }
    const unit = left > 0 ? '天' : (left === 0 ? '' : '天前');
    return h('button', {
      class: 'row-btn', 'aria-label': `编辑日程：${item.title}`, onClick: () => openScheduleEditor(item)
    },
    h('div', { class: 'sched', style: { background: urgencyColor(left) } },
      h('div', { class: 'grow' },
        h('div', { class: 'title ellipsis' }, item.title),
        h('div', { class: 'date' }, dayLabel(dayOf(new Date(item.targetDate)))),
        h('div', { class: 'progress' }, h('i', { style: { width: `${percent}%` } }))),
      h('div', { class: 'days' }, number, h('span', null, unit))));
  });
}

function todoRows(today) {
  const list = pendingTodos(ctx.state.planner, today, false);
  if (list.length === 0) {
    const doneToday = ctx.state.planner.history.some((r) => r.recordedDay === today && r.status === 'completed');
    if (doneToday) {
      return [h('div', { class: 'card empty empty-done' },
        h('div', { class: 'ring' }, svg(ICONS.check, 24)),
        h('div', null, '今天的待办都完成了'))];
    }
    return [h('div', { class: 'card empty' }, '今天没有待办')];
  }
  return list.slice(0, 6).map((todo) => {
    const late = todo.nextDay < today;
    const row = h('div', { class: 'card todo' },
      h('button', {
        class: 'check', 'aria-label': `完成：${todo.title}`,
        onClick: () => completeTodo(todo, row)
      }, svg(ICONS.check, 16)),
      h('button', { class: 'row-btn grow', onClick: () => openTodoEditor(todo) },
        h('div', { class: 'title ellipsis' }, todo.title),
        h('div', { class: `due${late ? ' late' : ''}` },
          h('span', { class: 'stars' }, starsText(todo.stars)),
          late ? ` · 逾期 ${today - todo.nextDay} 天` : '')));
    return row;
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
        h('div', { class: 'page-sub' }, `${greeting(d.getHours())} · 周${WEEK_NAMES[d.getDay()]} · ${weekText(now)}`)),
      h('button', { class: 'btn small soft', onClick: () => openScheduleEditor(null) }, '＋ 日程')),
    weekStrip(now),
    nextCard(now),
    h('div', { class: 'section-title' }, h('span', null, '今日课程'),
      h('button', { class: 'btn small', onClick: () => ctx.setTab('courses') }, '整周课表')),
    h('div', { class: 'list' }, courseRows(now)),
    h('div', { class: 'section-title' }, h('span', null, '日程倒计时'),
      h('button', { class: 'btn small', onClick: () => showSegment('schedule') }, '全部日程')),
    h('div', { class: 'list' }, scheduleCards(now)),
    h('div', { class: 'section-title' }, h('span', null, '待办'),
      h('button', { class: 'btn small', onClick: () => showSegment('todo') }, '全部待办')),
    h('div', { class: 'list' }, todoRows(today)),
    more > 0 ? h('div', { class: 'hint' }, `还有 ${more} 项，到「手账」查看`) : null,
    h('div', { style: { height: '8px' } }));
}
