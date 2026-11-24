/**
 * 新对话首页欢迎语池：克制、自然、带时段感知；首屏保持默认语，点击新任务或 Axis 标志时轮换。
 */

export const DEFAULT_GREETING = '我们从哪里开始？';

const CORE_GREETINGS = [
  '我们从哪里开始？',
  '今天想一起推进哪件事？',
  '把想法交给我，我们一步步落地。',
  '新的一轮，从哪个问题切入？',
  '先拆解思路，还是直接动手改代码？',
  '告诉我目标，其余交给 Axis。',
  '准备就绪，今天想攻克哪个难题？',
  '从一行代码或一个灵感开始。',
  '有什么想验证、梳理或重构的地方？',
  '把复杂需求交出来，我们清晰拆解。',
];

export function getTimeAwarePool(hour = new Date().getHours()): string[] {
  let timeSpecific: string[];
  if (hour >= 5 && hour < 10) {
    timeSpecific = ['早安，今天准备构建点什么？', '清晨适合攻克硬骨头，从哪里起笔？'];
  } else if (hour >= 10 && hour < 12) {
    timeSpecific = ['上午好，接下来要推进哪个任务？', '专注时段开启，有什么交给我处理？'];
  } else if (hour >= 12 && hour < 18) {
    timeSpecific = ['午后好，接下来交给 Axis 处理什么？', '继续保持节奏，这一轮解决什么问题？'];
  } else if (hour >= 18 && hour < 22) {
    timeSpecific = ['晚上好，今天还想把哪块拼图补齐？', '傍晚的思路往往最清澈，聊聊看？'];
  } else {
    timeSpecific = ['夜深了，我们轻快地把这件事收尾。', '深夜灵感在线，准备做点什么？'];
  }
  return [...CORE_GREETINGS, ...timeSpecific];
}

export function pickNextGreeting(current: string, hour = new Date().getHours()): string {
  const pool = getTimeAwarePool(hour);
  const idx = pool.indexOf(current);
  if (idx >= 0) {
    // 顺移并带轻微跳跃，避免单调但保证不重复
    const step = 1 + (current.length % 3);
    return pool[(idx + step) % pool.length] ?? CORE_GREETINGS[1]!;
  }
  return pool.find((g) => g !== current) ?? DEFAULT_GREETING;
}
