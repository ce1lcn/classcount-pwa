/**
 * 应用运行时上下文：由 app.js 填充，各视图只依赖这里，避免循环导入。
 * 所有 commit* 都是「先持久化、成功后才更新内存和界面」，失败返回 false 并已弹出错误提示。
 */
export const ctx = {
  /** { course, schedules, activeId, planner }，由 app.js 在启动时赋值 */
  state: null,
  store: null,
  /** 当前标签：today | courses | planner | data */
  tab: 'today',
  /** 存储是否退化为仅内存（隐私模式等），数据页会提示 */
  memoryOnly: false,
  setTab: () => {},
  rerender: () => {},
  commitCourse: () => false,
  commitSchedules: () => false,
  commitPlanner: () => false,
  replaceAll: () => false,
  /** 清除全部数据并回到空状态 */
  clearAll: () => false
};

export function uid() {
  return `${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
}
