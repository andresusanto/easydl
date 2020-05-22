export async function delay(ms: number): Promise<void> {
  return await new Promise((res) => setTimeout(res, ms));
}
