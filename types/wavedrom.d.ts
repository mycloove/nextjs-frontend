declare module 'wavedrom' {
  export type OnmlNode = [string, Record<string, unknown>, ...unknown[]]
  export const waveSkin: unknown
  export const onml: { stringify: (tree: OnmlNode) => string }
  export function renderAny(index: number, source: Record<string, unknown>, skin: unknown, notFirstSignal: boolean): OnmlNode
}