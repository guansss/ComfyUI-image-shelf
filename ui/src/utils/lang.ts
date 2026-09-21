export const EMPTY_ARRAY = Object.freeze([]) as unknown as any[]

export function arraysEqual<T>(a: ArrayLike<T>, b: ArrayLike<T>): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export function uuidv4() {
  const array = new Uint8Array(1)
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (+c ^ (crypto.getRandomValues(array)[0] & (15 >> (+c / 4)))).toString(16),
  )
}
