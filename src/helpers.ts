export async function delay(ms: number): Promise<void> {
  return await new Promise((res) => setTimeout(res, ms));
}

export function safeRun<T extends (...args: any) => any>(fn: T) {
  try {
    fn();
  } catch {}
}
