/** PWA 手账扩展；日期使用手账统一的本地日期日序。 */
import { completeTodo, nextOccurrence, reconcile } from './logic/planner.js';

export function weekStart(day) {
  return day - (((day + 3) % 7 + 7) % 7);
}

export function validateWeeklyNotes(data) {
  if (data.weeklyNotes === undefined) return data;
  if (!Array.isArray(data.weeklyNotes)) throw new Error('周记数据无法读取，原数据已保留');
  const weeks = new Set();
  for (const item of data.weeklyNotes) {
    if (!item || !Number.isInteger(item.week) || weekStart(item.week) !== item.week ||
        typeof item.body !== 'string' || !Number.isFinite(item.updatedAt) || weeks.has(item.week)) {
      throw new Error('周记数据无法读取，原数据已保留');
    }
    weeks.add(item.week);
  }
  return data;
}

/** 把昨天标为完成；保留更早的漏做记录和今天的独立待办。 */
export function completeYesterday(data, id, today) {
  const yesterday = today - 1;
  const todo = data.todos.find((item) => item.id === id);
  if (!todo || todo.finished || todo.nextDay > yesterday ||
      data.history.some((item) => item.todoId === id && item.status === 'completed' && item.recordedDay === yesterday)) return false;
  reconcile(data, today);
  const missedId = `${id}:${todo.revision}:missed:${yesterday}:${yesterday}`;
  data.history = data.history.filter((item) => item.id !== missedId);
  return completeTodo(data, id, yesterday);
}

/** 今天已勾选后，允许把昨天的漏做更正为完成。 */
export function canCorrectYesterday(data, record, today) {
  const yesterday = today - 1;
  const todo = data.todos.find((item) => item.id === record.todoId);
  if (!todo || record.id !== `${todo.id}:${todo.revision}:missed:${yesterday}:${yesterday}`) return false;
  const prefix = `${todo.id}:${todo.revision}:completed:`;
  return !data.history.some((item) => item.todoId === todo.id && item.status === 'completed' && item.recordedDay === yesterday) &&
    data.history.some((item) => item.id.startsWith(prefix) && item.status === 'completed' && item.recordedDay === today);
}

export function correctYesterday(data, recordId, today) {
  const record = data.history.find((item) => item.id === recordId);
  if (!record || !canCorrectYesterday(data, record, today)) return false;
  const todo = data.todos.find((item) => item.id === record.todoId);
  const prefix = `${todo.id}:${todo.revision}:completed:`;
  const completed = data.history.find((item) => item.id.startsWith(prefix) && item.status === 'completed' && item.recordedDay === today);
  record.id = `${todo.id}:${todo.revision}:completed:${today - 1}:${today - 1}`;
  record.status = 'completed';
  record.overdueDays = 0;
  if (nextOccurrence(todo, today) === today) {
    completed.dueDay = today;
    completed.overdueDays = 0;
    completed.id = `${prefix}${today}:${today}`;
  } else {
    data.history = data.history.filter((item) => item !== completed);
  }
  return true;
}
