export class QueueOverflowError extends Error {
  constructor() {
    super('Dropped: too much audio waiting to be transcribed.')
  }
}

/**
 * Runs async jobs with limited concurrency. When too many are waiting, the
 * oldest waiting job is dropped so the transcript stays current.
 */
export class TaskQueue {
  private active = 0
  private waiting: { start: () => void; reject: (e: Error) => void }[] = []
  private readonly concurrency: number
  private readonly maxWaiting: number

  constructor(concurrency = 3, maxWaiting = 12) {
    this.concurrency = concurrency
    this.maxWaiting = maxWaiting
  }

  get size(): { active: number; waiting: number } {
    return { active: this.active, waiting: this.waiting.length }
  }

  run<T>(job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = (): void => {
        this.active++
        job()
          .then(resolve, reject)
          .finally(() => {
            this.active--
            this.waiting.shift()?.start()
          })
      }
      if (this.active < this.concurrency) {
        start()
        return
      }
      this.waiting.push({ start, reject })
      if (this.waiting.length > this.maxWaiting) this.waiting.shift()?.reject(new QueueOverflowError())
    })
  }
}
