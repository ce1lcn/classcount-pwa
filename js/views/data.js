import { h, openSheet, confirmDialog, toast } from '../dom.js';
import { ctx } from '../ctx.js';
import { VERSION } from '../version.js';
import { toDateKey } from '../logic/course.js';
import { buildBackup, parseBackup, importCourseText, BACKUP_FORMAT } from '../store.js';
import { openTermStartEditor } from './courses.js';
import { showSegment } from './planner.js';

const MAX_FILE_BYTES = 8 * 1024 * 1024;

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

// ---------------------------------------------------------------- 导入

async function importText(text) {
  let root;
  try {
    root = JSON.parse(text);
  } catch (err) {
    toast('内容不是有效的 JSON，请检查是否完整复制', true);
    return false;
  }
  try {
    if (root !== null && typeof root === 'object' && root.format === BACKUP_FORMAT) {
      const incoming = parseBackup(text);
      const summary = `${incoming.course.items.length} 个课程格、${incoming.schedules.length} 个日程、` +
        `${incoming.planner.todos.length} 个待办、${incoming.planner.diaries.length} 篇日记`;
      if (!await confirmDialog({
        title: '用备份覆盖当前数据？', message: `备份里有 ${summary}。当前设备上的课表、日程和手账会被替换。`,
        okText: '覆盖', danger: true
      })) {
        return false;
      }
      return ctx.replaceAll(incoming);
    }
    const table = importCourseText(text, ctx.state.course);
    if (ctx.state.course.items.length > 0 && !await confirmDialog({
      title: '更新课表？', message: `将导入 ${table.items.length} 个课程格，已写的课程备注和单次备忘会保留。`, okText: '导入'
    })) {
      return false;
    }
    return ctx.commitCourse(table, `已导入 ${table.items.length} 个课程格`);
  } catch (err) {
    toast(err.message, true);
    return false;
  }
}

function pickFile() {
  const input = h('input', {
    type: 'file', accept: '.json,.txt,application/json,text/plain', style: { display: 'none' },
    onChange: async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) {
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        toast('文件太大，不像是课表或备份', true);
        return;
      }
      let text;
      try {
        text = await file.text();
      } catch (err) {
        toast('读取文件失败', true);
        return;
      }
      await importText(text);
    }
  });
  document.body.appendChild(input);
  input.click();
}

function openPasteSheet() {
  let value = '';
  const area = h('textarea', {
    class: 'textarea tall', placeholder: '把课表 JSON 或备份内容粘贴到这里', spellcheck: 'false',
    autocapitalize: 'off', autocomplete: 'off', onInput: (e) => { value = e.target.value; }
  });
  const sheet = openSheet({
    title: '粘贴内容导入',
    body: [h('p', { class: 'muted', style: { fontSize: '14px' } },
      '支持教务系统返回的 JSON、ClassCount 课表 JSON，以及 ClassCount 备份内容，会自动识别。'), area],
    foot: [
      h('button', { class: 'btn', onClick: () => sheet.close() }, '取消'),
      h('button', {
        class: 'btn primary',
        onClick: async () => {
          if (value.trim().length === 0) {
            toast('还没有粘贴内容', true);
            return;
          }
          if (await importText(value)) {
            sheet.close();
          }
        }
      }, '导入')
    ]
  });
}

// ---------------------------------------------------------------- 导出

async function exportFile() {
  const text = JSON.stringify(buildBackup(ctx.state), null, 2);
  const name = `ClassCount-备份-${stamp()}.json`;
  const file = new File([text], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') {
        return;
      }
      // 分享失败时回退到下载
    }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: name, style: { display: 'none' } });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 2000);
  toast('已生成备份文件');
}

async function copyBackup() {
  const text = JSON.stringify(buildBackup(ctx.state));
  try {
    await navigator.clipboard.writeText(text);
    toast('备份内容已复制，可粘贴到备忘录或聊天里');
  } catch (err) {
    // 剪贴板不可用时，给一个可手动全选复制的文本框
    const area = h('textarea', { class: 'textarea tall', readonly: true, spellcheck: 'false' });
    area.value = text;
    const sheet = openSheet({
      title: '手动复制备份', body: [h('p', { class: 'muted', style: { fontSize: '14px' } }, '长按文本框，全选后复制。'), area],
      foot: [h('button', { class: 'btn primary', onClick: () => sheet.close() }, '完成')]
    });
    area.focus();
    area.select();
  }
}

/** 可点击的数据行：点一下跳到对应页面 */
function jumpRow(label, value, go) {
  return h('button', { class: 'kv kv-link', onClick: go, 'aria-label': `${label}：${value}，点击查看` },
    h('span', null, label), h('span', null, value));
}

// ---------------------------------------------------------------- 诊断

function isStandalone() {
  return window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

function diagnostics() {
  const vv = window.visualViewport;
  const probe = h('div', { style: { position: 'absolute', visibility: 'hidden', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' } });
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const safe = `${cs.paddingTop} / ${cs.paddingBottom}`;
  probe.remove();
  return [
    `版本 ${VERSION}`,
    `窗口 ${window.innerWidth}×${window.innerHeight}  屏幕 ${screen.width}×${screen.height}`,
    vv ? `可视视口 ${Math.round(vv.width)}×${Math.round(vv.height)}  偏移 ${Math.round(vv.offsetTop)}  缩放 ${vv.scale}` : '无 visualViewport',
    `安全区 上/下 ${safe}`,
    `主屏幕模式 ${isStandalone() ? '是' : '否'}`,
    `系统深色模式 ${window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? '是' : '否'}`
  ].join('\n');
}

// ---------------------------------------------------------------- 视图

export function renderData(extra) {
  const t = ctx.state.course;
  const plan = ctx.state.planner;
  const problems = ctx.store.problems();
  const persisted = extra && extra.persisted;
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', null, h('h1', { class: 'page-title' }, '数据'),
        h('div', { class: 'page-sub' }, '导入、备份与应用信息'))),
    ctx.memoryOnly ? h('div', { class: 'banner error' },
      '当前浏览器不允许保存数据（可能是隐私模式），关闭页面后内容会丢失。请用普通模式打开，或把网页添加到主屏幕。') : null,
    problems.length > 0 ? h('div', { class: 'banner error' },
      `有数据读取异常，为避免覆盖已拒绝保存：${problems.join('；')}。可导入备份恢复，或在下方清除数据。`) : null,

    h('div', { class: 'section-title' }, h('span', null, '当前数据')),
    h('div', { class: 'card' },
      jumpRow('课表', t.items.length > 0 ? `${t.items.length} 个课程格` : '未导入', () => ctx.setTab('courses')),
      h('div', { class: 'kv' }, h('span', null, '开学日（第 1 周周一）'),
        h('span', null, t.termStart > 0 ? toDateKey(t.termStart) : '未设置')),
      jumpRow('日程', `${ctx.state.schedules.length} 个`, () => showSegment('schedule')),
      jumpRow('待办', `${plan.todos.length} 个`, () => showSegment('todo')),
      jumpRow('日记', `${plan.diaries.filter((d) => d.body.trim().length > 0).length} 篇`, () => showSegment('diary')),
      h('div', { style: { marginTop: '10px' } },
        h('button', { class: 'btn small', onClick: openTermStartEditor }, '设置开学日'))),

    h('div', { class: 'section-title' }, h('span', null, '导入')),
    h('div', { class: 'card' },
      h('p', { class: 'muted', style: { fontSize: '14px', marginBottom: '10px' } },
        '选择课表文件或备份文件，或直接粘贴内容，会自动识别类型。'),
      h('div', { class: 'group' },
        h('button', { class: 'btn primary block', onClick: pickFile }, '选择文件导入'),
        h('button', { class: 'btn block', onClick: openPasteSheet }, '粘贴内容导入'))),

    h('div', { class: 'section-title' }, h('span', null, '备份')),
    h('div', { class: 'card' },
      h('p', { class: 'muted', style: { fontSize: '14px', marginBottom: '10px' } },
        '数据只保存在这台设备的浏览器里。换设备或清理 Safari 数据前，请先导出备份。'),
      h('div', { class: 'group' },
        h('button', { class: 'btn primary block', onClick: exportFile }, '导出备份文件'),
        h('button', { class: 'btn block', onClick: copyBackup }, '复制备份内容'))),

    h('div', { class: 'section-title' }, h('span', null, '关于')),
    h('div', { class: 'card' },
      h('div', { class: 'kv' }, h('span', null, '版本'), h('span', null, VERSION)),
      h('div', { class: 'kv' }, h('span', null, '运行方式'),
        h('span', null, isStandalone() ? '主屏幕 App（数据不会被自动清理）' : '浏览器标签页（数据可能被清理，请添加到主屏幕）')),
      h('div', { class: 'kv' }, h('span', null, '持久存储'),
        h('span', null, persisted === true ? '已授予' : (persisted === false ? '未授予（iOS 常见，不影响主屏幕 App）' : '检测中'))),
      h('details', { style: { marginTop: '8px' } },
        h('summary', { class: 'muted small' }, '诊断信息（排查显示问题时用）'),
        h('pre', { class: 'small muted', style: { whiteSpace: 'pre-wrap', margin: '6px 0 0' } }, diagnostics())),
      h('p', { class: 'hint' },
        '安装到主屏幕：在 Safari 点底部「分享」→「添加到主屏幕」。之后从桌面图标打开，会像普通 App 一样全屏运行，并可离线使用。')),

    h('div', { class: 'section-title' }, h('span', null, '危险操作')),
    h('div', { class: 'card' },
      h('button', {
        class: 'btn danger block',
        onClick: async () => {
          if (await confirmDialog({
            title: '清除全部数据？', message: '课表、日程、待办和日记会从这台设备上永久删除，且无法恢复。建议先导出备份。',
            okText: '清除', danger: true
          })) {
            ctx.clearAll();
          }
        }
      }, '清除全部数据')),
    h('div', { style: { height: '12px' } }));
}
