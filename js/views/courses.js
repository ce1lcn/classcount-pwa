import { h, openSheet, courseColor, minutesText } from '../dom.js';
import { ctx } from '../ctx.js';
import {
  weekOfTerm, startOfToday, startOfWeek, toDateKey, sectionStartTime, sectionEndTime
} from '../logic/course.js';

const SECTIONS = 12;
const DAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'];
const MAX_WEEK = 30;

const ui = {
  week: 0,
  /** 下一次渲染要播放的换周动画：'' | 'slide-next' | 'slide-prev'，播放后清空 */
  slide: ''
};

function currentWeek() {
  const t = ctx.state.course;
  if (t.termStart <= 0) {
    return 1;
  }
  return Math.min(MAX_WEEK, Math.max(1, weekOfTerm(t, Date.now())));
}

/** 第 week 周、星期 dow（1=周一）对应的日期 */
function dateOf(week, dow) {
  const base = new Date(startOfToday(ctx.state.course.termStart));
  base.setDate(base.getDate() + (week - 1) * 7 + (dow - 1));
  return base;
}

/** 课表格里的教室名：去掉横线两侧的空格，缩短后更不容易折行 */
function shortRoom(room) {
  return room.replace(/\s*[－—–-]\s*/g, '-');
}

function itemsOfDay(week, dow) {
  return ctx.state.course.items
    .filter((it) => it.dayOfWeek === dow && it.weekList.indexOf(week) >= 0)
    .sort((a, b) => a.startSection - b.startSection);
}

/** 同一天内时间重叠的课合并为一组：手机屏幕太窄，不并排挤在一起，点开后再选 */
function clusterDay(items) {
  const sorted = items.slice().sort((a, b) => a.startSection - b.startSection || a.endSection - b.endSection);
  const clusters = [];
  for (const it of sorted) {
    const last = clusters.length > 0 ? clusters[clusters.length - 1] : null;
    if (last !== null && it.startSection <= last.end) {
      last.items.push(it);
      last.end = Math.max(last.end, it.endSection);
    } else {
      clusters.push({ items: [it], start: it.startSection, end: it.endSection });
    }
  }
  return clusters;
}

/** 当前时刻在课表纵轴上的位置（0~1）；上课前、下课后返回 null。课间落在上一节的底边。 */
function nowFraction(minute) {
  for (let i = 0; i < SECTIONS; i++) {
    const s = sectionStartTime(i + 1);
    const e = sectionEndTime(i + 1);
    if (minute >= s && minute <= e) {
      return (i + (minute - s) / (e - s)) / SECTIONS;
    }
    if (i < SECTIONS - 1 && minute > e && minute < sectionStartTime(i + 2)) {
      return (i + 1) / SECTIONS;
    }
  }
  return null;
}

function maxWeekOfTerm() {
  let m = 16;
  for (const it of ctx.state.course.items) {
    for (const w of it.weekList) {
      m = Math.max(m, w);
    }
  }
  return Math.min(MAX_WEEK, m);
}

function changeWeek(delta) {
  const next = Math.min(MAX_WEEK, Math.max(1, ui.week + delta));
  if (next === ui.week) {
    return;
  }
  ui.week = next;
  ui.slide = delta > 0 ? 'slide-next' : 'slide-prev';
  ctx.rerender();
}

// ---------------------------------------------------------------- 弹层

export function openTermStartEditor() {
  const t = ctx.state.course;
  const initial = t.termStart > 0 ? toDateKey(t.termStart) : toDateKey(startOfWeek(Date.now()));
  let value = initial;
  const errorBox = h('div', { class: 'form-error' });
  const sheet = openSheet({
    title: '设置开学日',
    body: [
      h('p', { class: 'muted', style: { fontSize: '14px' } }, '课表按周次排课。请选择学期第 1 周中的任意一天，系统会自动取那一周的周一。'),
      h('div', { class: 'field' }, h('label', null, '第 1 周的日期'),
        h('input', { class: 'input', type: 'date', value, onInput: (e) => { value = e.target.value; } })),
      errorBox
    ],
    foot: [
      h('button', { class: 'btn', onClick: () => sheet.close() }, '取消'),
      h('button', {
        class: 'btn primary',
        onClick: () => {
          const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
          if (m === null) {
            errorBox.textContent = '请选择有效日期';
            return;
          }
          const picked = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
          const next = JSON.parse(JSON.stringify(ctx.state.course));
          next.termStart = startOfWeek(picked);
          next.termStartUserSet = true;
          if (ctx.commitCourse(next, '开学日已保存')) {
            ui.week = 0;
            sheet.close();
          }
        }
      }, '保存')
    ]
  });
}

function courseRow(it, onClick) {
  return h('button', { class: 'row-btn', onClick },
    h('div', { class: 'card course-row' },
      h('div', { class: 'bar', style: { background: courseColor(it.name) } }),
      h('div', { class: 'time' }, minutesText(sectionStartTime(it.startSection)), h('br'),
        minutesText(sectionEndTime(it.endSection))),
      h('div', { class: 'grow' },
        h('div', { class: 'title' }, it.name),
        h('div', { class: 'muted small' },
          `${it.room || '待定'} · 第 ${it.startSection}-${it.endSection} 节${it.teacher ? ` · ${it.teacher}` : ''}`))));
}

function openClusterPicker(cluster, week) {
  const sheet = openSheet({
    title: '这个时段有多门课',
    body: [h('div', { class: 'list' }, cluster.items.map((it) => courseRow(it, () => {
      sheet.close();
      openCourseDetail(it, week);
    })))]
  });
}

/** 某一天的课程列表（点星期表头打开） */
export function openDaySheet(week, dow) {
  const date = dateOf(week, dow);
  const list = itemsOfDay(week, dow);
  const sheet = openSheet({
    title: `周${DAY_NAMES[dow - 1]} · ${date.getMonth() + 1}月${date.getDate()}日`,
    body: [
      h('div', { class: 'muted small', style: { marginBottom: '8px' } }, `第 ${week} 周 · ${list.length} 门课`),
      list.length > 0
        ? h('div', { class: 'list' }, list.map((it) => courseRow(it, () => {
          sheet.close();
          openCourseDetail(it, week);
        })))
        : h('div', { class: 'card empty' }, '这天没有课，好好休息')
    ]
  });
}

function openWeekPicker() {
  const nowWeek = currentWeek();
  const total = maxWeekOfTerm();
  const sheet = openSheet({
    title: '跳到某一周',
    body: [
      h('div', { class: 'chips' }, Array.from({ length: total }, (_, i) => i + 1).map((n) => h('button', {
        class: `chip${n === nowWeek ? ' ghost' : ''}`, 'aria-pressed': n === ui.week,
        onClick: () => {
          ui.slide = n > ui.week ? 'slide-next' : (n < ui.week ? 'slide-prev' : '');
          ui.week = n;
          sheet.close();
          ctx.rerender();
        }
      }, String(n)))),
      h('div', { class: 'hint' }, `第 ${nowWeek} 周是本周，已用浅绿色标出。`)
    ]
  });
}

export function openCourseDetail(item, week) {
  const date = toDateKey(dateOf(week, item.dayOfWeek).getTime());
  const v = { memo: item.memo, dayMemo: item.dayMemos[date] || '' };
  const memoInput = h('textarea', {
    class: 'textarea', placeholder: '如：要带实验报告', onInput: (e) => { v.memo = e.target.value; }
  });
  memoInput.value = v.memo;
  const dayInput = h('textarea', {
    class: 'textarea', placeholder: '如：下节课小测', onInput: (e) => { v.dayMemo = e.target.value; }
  });
  dayInput.value = v.dayMemo;
  const sheet = openSheet({
    title: item.name,
    body: [
      h('div', { class: 'card' },
        h('div', { class: 'kv' }, h('span', null, '时间'),
          h('span', null, `周${DAY_NAMES[item.dayOfWeek - 1]} 第 ${item.startSection}-${item.endSection} 节 ` +
            `${minutesText(sectionStartTime(item.startSection))}–${minutesText(sectionEndTime(item.endSection))}`)),
        h('div', { class: 'kv' }, h('span', null, '日期'), h('span', null, `${date}（第 ${week} 周）`)),
        h('div', { class: 'kv' }, h('span', null, '地点'), h('span', null, item.room || '待定')),
        item.teacher ? h('div', { class: 'kv' }, h('span', null, '教师'), h('span', null, item.teacher)) : null,
        h('div', { class: 'kv' }, h('span', null, '周次'), h('span', null, item.weeksText || '—')),
        item.nature || item.credit ? h('div', { class: 'kv' }, h('span', null, '性质'),
          h('span', null, [item.nature, item.credit ? `${item.credit} 学分` : ''].filter(Boolean).join(' · '))) : null),
      h('div', { class: 'field' }, h('label', null, '课程备注（每次上课都显示）'), memoInput),
      h('div', { class: 'field' }, h('label', null, `本次课备忘（${date}）`), dayInput)
    ].filter((node) => node !== null),
    foot: [
      h('button', { class: 'btn', onClick: () => sheet.close() }, '取消'),
      h('button', {
        class: 'btn primary',
        onClick: () => {
          const next = JSON.parse(JSON.stringify(ctx.state.course));
          for (const it of next.items) {
            if (it.name === item.name) {
              it.memo = v.memo;
            }
            if (it.id === item.id) {
              if (v.dayMemo.length > 0) {
                it.dayMemos[date] = v.dayMemo;
              } else {
                delete it.dayMemos[date];
              }
            }
          }
          if (ctx.commitCourse(next, '备注已保存')) {
            sheet.close();
          }
        }
      }, '保存')
    ]
  });
}

/** 从其他页面跳到课表并直接打开某门课（如首页「下一节」卡片） */
export function showCourse(item, week) {
  ui.week = Math.min(MAX_WEEK, Math.max(1, week));
  ui.slide = '';
  if (ctx.tab === 'courses') {
    ctx.rerender();
  } else {
    ctx.setTab('courses');
  }
  setTimeout(() => openCourseDetail(item, ui.week), 140);
}

// ---------------------------------------------------------------- 页面

export function renderCourses() {
  const table = ctx.state.course;
  if (table.items.length === 0) {
    return h('div', { class: 'page' },
      h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, '课表')),
      h('div', { class: 'card empty' },
        h('p', null, '还没有课表数据'),
        h('div', { style: { marginTop: '12px' } },
          h('button', { class: 'btn primary', onClick: () => ctx.setTab('data') }, '去「数据」页导入'))));
  }
  if (table.termStart <= 0) {
    return h('div', { class: 'page' },
      h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, '课表')),
      h('div', { class: 'card empty' },
        h('p', null, '课表已导入，还需要设置开学日才能按周显示'),
        h('div', { style: { marginTop: '12px' } },
          h('button', { class: 'btn primary', onClick: openTermStartEditor }, '设置开学日'))));
  }

  const nowWeek = currentWeek();
  if (ui.week < 1) {
    ui.week = nowWeek;
  }
  const week = ui.week;
  const slide = ui.slide;
  ui.slide = '';

  const now = new Date();
  const todayKey = toDateKey(now.getTime());
  const minute = now.getHours() * 60 + now.getMinutes();
  const start = dateOf(week, 1);
  const end = dateOf(week, 7);
  const range = `${start.getMonth() + 1}/${start.getDate()} – ${end.getMonth() + 1}/${end.getDate()}`;
  let total = 0;

  const head = [h('div')];
  const cols = [h('div', { class: 'grid-times' }, Array.from({ length: SECTIONS }, (_, i) => h('div', null,
    h('b', null, String(i + 1)), minutesText(sectionStartTime(i + 1)).replace(/^0/, ''))))];
  for (let dow = 1; dow <= 7; dow++) {
    const date = dateOf(week, dow);
    const key = toDateKey(date.getTime());
    const isToday = key === todayKey;
    const isPastDay = key < todayKey;
    head.push(h('button', {
      class: isToday ? 'today' : '', 'aria-label': `周${DAY_NAMES[dow - 1]} ${date.getMonth() + 1}月${date.getDate()}日，查看当天课程`,
      onClick: () => openDaySheet(week, dow)
    }, DAY_NAMES[dow - 1], h('br'), h('span', { class: 'd' }, String(date.getDate()))));

    const blocks = clusterDay(itemsOfDay(week, dow)).map((cluster) => {
      total += cluster.items.length;
      const first = cluster.items[0];
      const many = cluster.items.length > 1;
      const rows = cluster.end - cluster.start + 1;
      const hasMemo = cluster.items.some((it) => it.memo.length > 0 || (it.dayMemos[key] || '').length > 0);
      const endMin = sectionEndTime(cluster.end);
      const startMin = sectionStartTime(cluster.start);
      const live = isToday && week === nowWeek && minute >= startMin && minute <= endMin;
      const past = isPastDay || (isToday && minute > endMin);
      const lines = Math.max(2, Math.round(rows * 3.6) - 1);
      return h('button', {
        class: `course-block${many ? ' multi' : ''}${live ? ' live' : ''}${past && !live ? ' past' : ''}`,
        'aria-label': many ? `${cluster.items.length} 门课时间重叠` : `${first.name}，${first.room}，第${first.startSection}到${first.endSection}节`,
        style: {
          '--c': many ? '#7A7066' : courseColor(first.name),
          top: `calc(${cluster.start - 1} * 100% / ${SECTIONS} + 1px)`,
          height: `calc(${rows} * 100% / ${SECTIONS} - 2px)`
        },
        onClick: () => (many ? openClusterPicker(cluster, week) : openCourseDetail(first, week))
      }, h('b', { style: { '-webkit-line-clamp': String(lines) } }, first.name),
      many ? h('span', null, `另有 ${cluster.items.length - 1} 门`) : (first.room ? h('span', null, shortRoom(first.room)) : null),
      hasMemo ? h('i', { class: 'dot' }) : null);
    });

    const frac = isToday && week === nowWeek ? nowFraction(minute) : null;
    if (frac !== null) {
      blocks.push(h('div', { class: 'now-line', style: { top: `${frac * 100}%` } }));
    }
    cols.push(h('div', { class: `grid-col${isToday ? ' today' : ''}` }, blocks));
  }

  const wrap = h('div', { class: 'grid-wrap' },
    h('div', { class: 'grid-head' }, head),
    h('div', { class: `grid-body ${slide}` }, cols),
    total === 0 ? h('div', { class: 'grid-empty' }, '这周没有课') : null);

  // 左右滑动换周
  let sx = 0;
  let sy = 0;
  let tracking = false;
  wrap.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      tracking = true;
    }
  }, { passive: true });
  wrap.addEventListener('touchend', (e) => {
    if (!tracking) {
      return;
    }
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      changeWeek(dx < 0 ? 1 : -1);
    }
  }, { passive: true });

  return h('div', { class: 'page fit' },
    h('div', { class: 'week-bar' },
      h('button', { class: 'icon-btn', 'aria-label': '上一周', disabled: week <= 1, onClick: () => changeWeek(-1) }, '‹'),
      h('button', { class: 'mid', 'aria-label': '跳到某一周', onClick: openWeekPicker },
        h('b', null, `第 ${week} 周`), h('span', null, range)),
      week !== nowWeek ? h('button', {
        class: 'now-pill',
        onClick: () => {
          ui.slide = nowWeek > week ? 'slide-next' : 'slide-prev';
          ui.week = nowWeek;
          ctx.rerender();
        }
      }, '本周') : null,
      h('button', { class: 'icon-btn', 'aria-label': '下一周', disabled: week >= MAX_WEEK, onClick: () => changeWeek(1) }, '›')),
    wrap);
}

export function resetCoursesView() {
  ui.week = 0;
  ui.slide = '';
}
