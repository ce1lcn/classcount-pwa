import { h, openSheet, courseColor, minutesText } from '../dom.js';
import { ctx } from '../ctx.js';
import {
  weekOfTerm, startOfToday, startOfWeek, toDateKey, sectionStartTime, sectionEndTime
} from '../logic/course.js';

const SECTIONS = 12;
const ROW_H = 50;
const DAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'];
const MAX_WEEK = 30;

const ui = { week: 0 };

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

function openClusterPicker(cluster, week) {
  const sheet = openSheet({
    title: '这个时段有多门课',
    body: [h('div', { class: 'list' }, cluster.items.map((it) => h('button', {
      class: 'row-btn',
      onClick: () => {
        sheet.close();
        openCourseDetail(it, week);
      }
    }, h('div', { class: 'card course-row' },
      h('div', { class: 'bar', style: { background: courseColor(it.name) } }),
      h('div', { class: 'grow' },
        h('div', { class: 'title' }, it.name),
        h('div', { class: 'muted small' },
          `${it.room || '待定'} · 第 ${it.startSection}-${it.endSection} 节 · ${it.weeksText}`))))))]
  });
}

function openCourseDetail(item, week) {
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
        h('div', { class: 'kv' }, h('span', null, '地点'), h('span', null, item.room || '待定')),
        item.teacher ? h('div', { class: 'kv' }, h('span', null, '教师'), h('span', null, item.teacher)) : null,
        h('div', { class: 'kv' }, h('span', null, '周次'), h('span', null, item.weeksText || '—')),
        item.nature || item.credit ? h('div', { class: 'kv' }, h('span', null, '性质'),
          h('span', null, [item.nature, item.credit ? `${item.credit} 学分` : ''].filter(Boolean).join(' · '))) : null),
      h('div', { class: 'field' }, h('label', null, '课程备注（每次上课都显示）'), memoInput),
      h('div', { class: 'field' }, h('label', null, `本次课备忘（${date}）`), dayInput)
    ],
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
  const todayKey = toDateKey(Date.now());
  const start = dateOf(week, 1);
  const end = dateOf(week, 7);
  const range = `${start.getMonth() + 1}/${start.getDate()} – ${end.getMonth() + 1}/${end.getDate()}`;
  const inWeek = table.items.filter((it) => it.weekList.indexOf(week) >= 0);

  const head = [h('div', null)];
  const cols = [h('div', { class: 'grid-times' }, Array.from({ length: SECTIONS }, (_, i) => h('div', null,
    String(i + 1), h('br'), minutesText(sectionStartTime(i + 1)).replace(/^0/, ''))))];
  for (let dow = 1; dow <= 7; dow++) {
    const date = dateOf(week, dow);
    const isToday = toDateKey(date.getTime()) === todayKey;
    head.push(h('div', { class: isToday ? 'today' : '' }, `周${DAY_NAMES[dow - 1]}`,
      h('b', null, String(date.getDate()))));
    const key = toDateKey(date.getTime());
    const blocks = clusterDay(inWeek.filter((it) => it.dayOfWeek === dow)).map((cluster) => {
      const first = cluster.items[0];
      const many = cluster.items.length > 1;
      const hasMemo = cluster.items.some((it) => it.memo.length > 0 || (it.dayMemos[key] || '').length > 0);
      return h('button', {
        class: `course-block${many ? ' multi' : ''}`,
        'aria-label': many ? `${cluster.items.length} 门课时间重叠` : `${first.name}，${first.room}，第${first.startSection}到${first.endSection}节`,
        style: {
          '--c': many ? '#7A7066' : courseColor(first.name),
          top: `${(cluster.start - 1) * ROW_H + 1}px`,
          height: `${(cluster.end - cluster.start + 1) * ROW_H - 2}px`,
          left: '0',
          width: 'calc(100% - 1px)'
        },
        onClick: () => (many ? openClusterPicker(cluster, week) : openCourseDetail(first, week))
      }, h('b', null, first.name),
      many ? h('span', null, `另有 ${cluster.items.length - 1} 门`) : (first.room ? h('span', null, first.room) : null),
      hasMemo ? h('i', { class: 'dot' }) : null);
    });
    cols.push(h('div', { class: `grid-col${isToday ? ' today' : ''}` }, blocks));
  }

  return h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', null, h('h1', { class: 'page-title' }, '课表'),
        h('div', { class: 'page-sub' }, `${table.items.length} 个课程格`)),
      h('button', { class: 'btn small', onClick: openTermStartEditor }, '开学日')),
    h('div', { class: 'week-nav' },
      h('button', { class: 'icon-btn', 'aria-label': '上一周', disabled: week <= 1, onClick: () => { ui.week = week - 1; ctx.rerender(); } }, '‹'),
      h('div', { class: 'mid' }, h('b', null, `第 ${week} 周`), h('div', { class: 'muted small' }, range)),
      h('button', { class: 'icon-btn', 'aria-label': '下一周', disabled: week >= MAX_WEEK, onClick: () => { ui.week = week + 1; ctx.rerender(); } }, '›')),
    week !== nowWeek ? h('div', { style: { marginBottom: '10px' } },
      h('button', { class: 'btn small soft', onClick: () => { ui.week = nowWeek; ctx.rerender(); } }, `回到本周（第 ${nowWeek} 周）`)) : null,
    h('div', { class: 'grid-wrap', style: { '--row-h': `${ROW_H}px` } },
      h('div', { class: 'grid-head' }, head),
      h('div', { class: 'grid-body', style: { position: 'relative' } }, cols)),
    inWeek.length === 0 ? h('div', { class: 'hint', style: { textAlign: 'center' } }, `第 ${week} 周没有课`) : null);
}

export function resetCoursesView() {
  ui.week = 0;
}

