/**
 * 持久化与导入导出。不依赖 DOM，存储对象由外部注入（浏览器里是 localStorage），便于离线测试。
 *
 * 规则：
 *  - 读到损坏数据时保留原文并拒绝覆盖，把问题交给界面显示，绝不静默用空数据顶替。
 *  - 写入后立即读回校验，失败抛出中文错误，调用方只在成功后才更新界面状态。
 */
import { CourseTable, CourseItem, parseKbJson, parseWeeks, startOfWeek } from './logic/course.js';
import { Schedule } from './logic/schedule.js';
import { PlannerData, decodePlanner } from './logic/planner.js';

export const KEYS = {
  course: 'classcount.course.v1',
  schedules: 'classcount.schedules.v1',
  active: 'classcount.active.v1',
  planner: 'classcount.planner.v1'
};

export const BACKUP_FORMAT = 'classcount-backup';
const DAY_MS = 86400000;

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function str(v, def = '') {
  return typeof v === 'string' ? v : (v === null || v === undefined ? def : String(v));
}

function int(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

/** 把任意 JSON 对象规整成 CourseTable，补全 weekList / id / 备注容器，并让同名课程共享备注 */
export function normalizeCourseTable(obj) {
  if (!isObject(obj) || !Array.isArray(obj.items)) {
    throw new Error('不是有效的课表数据（缺少 items）');
  }
  const table = new CourseTable();
  table.xnm = str(obj.xnm);
  table.xqm = str(obj.xqm);
  table.termStart = Math.max(0, int(obj.termStart, 0));
  table.fetchedAt = Math.max(0, int(obj.fetchedAt, 0));
  table.currentWeek = Math.max(0, int(obj.currentWeek, 0));
  table.termStartUserSet = obj.termStartUserSet === true;
  for (const raw of obj.items) {
    if (!isObject(raw)) {
      continue;
    }
    const it = new CourseItem();
    it.name = str(raw.name, '未知课程');
    it.teacher = str(raw.teacher);
    it.room = str(raw.room);
    it.dayOfWeek = Math.min(7, Math.max(1, int(raw.dayOfWeek, 1)));
    it.startSection = Math.max(1, int(raw.startSection, 1));
    it.endSection = Math.max(it.startSection, int(raw.endSection, it.startSection));
    it.weeksText = str(raw.weeksText);
    const list = Array.isArray(raw.weekList) ? raw.weekList.map((w) => int(w, 0)).filter((w) => w > 0) : [];
    it.weekList = list.length > 0 ? list : parseWeeks(it.weeksText);
    it.memo = str(raw.memo);
    it.dayMemos = {};
    if (isObject(raw.dayMemos)) {
      for (const k of Object.keys(raw.dayMemos)) {
        if (typeof raw.dayMemos[k] === 'string') {
          it.dayMemos[k] = raw.dayMemos[k];
        }
      }
    }
    it.nature = str(raw.nature);
    it.credit = str(raw.credit);
    it.id = str(raw.id) || `${it.name}|${it.dayOfWeek}|${it.startSection}|${it.weeksText}`;
    table.items.push(it);
  }
  shareMemos(table);
  return table;
}

/** 课程备注按课程名共享：取同名项里第一个非空值回填 */
function shareMemos(table) {
  const shared = {};
  for (const it of table.items) {
    if (it.memo.length > 0 && shared[it.name] === undefined) {
      shared[it.name] = it.memo;
    }
  }
  for (const it of table.items) {
    if (shared[it.name] !== undefined) {
      it.memo = shared[it.name];
    }
  }
}

/** 导入新课表时保留本机已写的备注；导入文件里有非空备注则以导入为准 */
export function carryMemos(next, old) {
  const byId = new Map(old.items.map((it) => [it.id, it]));
  for (const it of next.items) {
    const prev = byId.get(it.id);
    if (prev === undefined) {
      continue;
    }
    if (it.memo.length === 0) {
      it.memo = prev.memo;
    }
    it.dayMemos = Object.assign({}, prev.dayMemos, it.dayMemos);
  }
  shareMemos(next);
}

/**
 * 解析导入的课表文本。接受三种格式：
 *  1. 教务系统接口原始返回（含 kbList）
 *  2. ClassCount 的课表 JSON（含 items，例如 kebiao_init.json）
 *  3. ClassCount 备份文件（含 course.items）
 */
export function importCourseText(text, old, now = Date.now()) {
  let root;
  try {
    root = JSON.parse(text);
  } catch (err) {
    throw new Error('内容不是有效的 JSON，请检查是否完整复制');
  }
  let table;
  if (isObject(root) && Array.isArray(root.kbList)) {
    table = parseKbJson(text, old.xnm, old.xqm);
    table.items.forEach((it) => {
      it.memo = it.memo || '';
      it.dayMemos = it.dayMemos || {};
    });
    if (table.currentWeek > 0) {
      table.termStart = startOfWeek(now) - (table.currentWeek - 1) * 7 * DAY_MS;
    }
  } else if (isObject(root) && Array.isArray(root.items)) {
    table = normalizeCourseTable(root);
  } else if (isObject(root) && isObject(root.course) && Array.isArray(root.course.items)) {
    table = normalizeCourseTable(root.course);
  } else {
    throw new Error('没有识别到课表：需要教务系统返回的 JSON（含 kbList）或 ClassCount 课表 JSON（含 items）');
  }
  if (table.items.length === 0) {
    throw new Error('课表里没有课程');
  }
  if (old.termStartUserSet && old.termStart > 0) {
    table.termStart = old.termStart;
    table.termStartUserSet = true;
  } else if (table.termStart <= 0) {
    table.termStart = old.termStart;
  }
  if (table.xnm.length === 0) {
    table.xnm = old.xnm;
    table.xqm = old.xqm;
  }
  carryMemos(table, old);
  table.fetchedAt = now;
  return table;
}

function normalizeSchedules(list) {
  if (!Array.isArray(list)) {
    throw new Error('日程数据格式不对');
  }
  const out = [];
  for (const raw of list) {
    if (!isObject(raw) || typeof raw.id !== 'string' || raw.id.length === 0 || typeof raw.title !== 'string' ||
      !Number.isFinite(raw.targetDate) || !Number.isFinite(raw.createdDate)) {
      throw new Error('日程数据格式不对');
    }
    out.push(new Schedule(raw.id, raw.title, raw.targetDate, raw.createdDate, str(raw.note)));
  }
  return out;
}

export function emptyState() {
  return {
    course: new CourseTable(),
    schedules: [],
    activeId: '',
    planner: new PlannerData()
  };
}

export function buildBackup(state, now = Date.now()) {
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: now,
    course: state.course,
    schedules: state.schedules,
    activeId: state.activeId,
    planner: state.planner
  };
}

/** 校验并解析备份文件；任何一项不合法都整体拒绝，不做部分导入 */
export function parseBackup(text) {
  let root;
  try {
    root = JSON.parse(text);
  } catch (err) {
    throw new Error('备份文件不是有效的 JSON');
  }
  if (!isObject(root) || root.format !== BACKUP_FORMAT) {
    throw new Error('这不是 ClassCount 的备份文件');
  }
  if (root.version !== 1) {
    throw new Error('备份文件版本较新，请先更新应用');
  }
  const state = emptyState();
  if (root.course !== undefined && root.course !== null) {
    state.course = normalizeCourseTable(root.course);
  }
  state.schedules = normalizeSchedules(root.schedules === undefined ? [] : root.schedules);
  state.activeId = str(root.activeId);
  if (root.planner !== undefined && root.planner !== null) {
    state.planner = decodePlanner(JSON.stringify(root.planner));
  }
  return state;
}

export class Store {
  constructor(storage) {
    this.storage = storage;
    /** key -> 读到损坏数据时的说明；有值的 key 拒绝写入 */
    this.corrupt = {};
  }

  readJson(key, fallback, check) {
    let raw = null;
    try {
      raw = this.storage.getItem(key);
    } catch (err) {
      this.corrupt[key] = '浏览器存储不可用';
      return fallback;
    }
    if (raw === null || raw === '') {
      return fallback;
    }
    try {
      return check(JSON.parse(raw));
    } catch (err) {
      this.corrupt[key] = err.message || '数据损坏';
      return fallback;
    }
  }

  load() {
    this.corrupt = {};
    const state = emptyState();
    state.course = this.readJson(KEYS.course, state.course, normalizeCourseTable);
    state.schedules = this.readJson(KEYS.schedules, state.schedules, normalizeSchedules);
    state.activeId = this.readJson(KEYS.active, '', (v) => str(v));
    state.planner = this.readJson(KEYS.planner, state.planner, (v) => decodePlanner(JSON.stringify(v)));
    return state;
  }

  problems() {
    return Object.keys(this.corrupt).map((k) => `${k.split('.')[1]}：${this.corrupt[k]}`);
  }

  write(key, value) {
    if (this.corrupt[key] !== undefined) {
      throw new Error('这部分数据读取时发现损坏，为避免覆盖已拒绝保存。请先在「数据」页导入备份或清除数据');
    }
    const raw = JSON.stringify(value);
    try {
      this.storage.setItem(key, raw);
      if (this.storage.getItem(key) !== raw) {
        throw new Error('读回校验失败');
      }
    } catch (err) {
      throw new Error('保存失败：浏览器存储已满或不可用');
    }
  }

  saveCourse(table) {
    this.write(KEYS.course, table);
  }

  saveSchedules(list, activeId) {
    this.write(KEYS.schedules, list);
    this.write(KEYS.active, activeId);
  }

  savePlanner(data) {
    this.write(KEYS.planner, data);
  }

  /** 整体替换（导入备份）：先全部校验写入，任何一项失败则还原 */
  replaceAll(state) {
    const entries = [
      [KEYS.course, state.course],
      [KEYS.schedules, state.schedules],
      [KEYS.active, state.activeId],
      [KEYS.planner, state.planner]
    ];
    const previous = new Map(entries.map(([k]) => [k, this.storage.getItem(k)]));
    const wasCorrupt = this.corrupt;
    const written = [];
    try {
      this.corrupt = {};
      for (const [key, value] of entries) {
        this.write(key, value);
        written.push(key);
      }
    } catch (err) {
      // 只还原已经成功写入的键；还原本身失败要如实告知，不能假装回到了原状
      let restoreFailed = false;
      for (const key of written) {
        try {
          const old = previous.get(key);
          if (old === null) {
            this.storage.removeItem(key);
          } else {
            this.storage.setItem(key, old);
          }
        } catch (restoreError) {
          restoreFailed = true;
        }
      }
      this.corrupt = wasCorrupt;
      if (restoreFailed) {
        throw new Error('导入失败，且无法还原原数据，请立刻导出备份并重新打开应用');
      }
      throw err;
    }
  }

  clearAll() {
    Object.values(KEYS).forEach((k) => this.storage.removeItem(k));
    this.corrupt = {};
  }
}
