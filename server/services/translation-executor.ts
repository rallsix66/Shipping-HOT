let executorTail = Promise.resolve()

/** Serializes translation budget checks, Provider calls and their local persistence in one process. */
export async function withTranslationExecutor<T>(work: () => Promise<T>): Promise<T> {
  const previous = executorTail
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  executorTail = previous.then(() => current)
  await previous
  try {
    return await work()
  } finally {
    release()
  }
}
