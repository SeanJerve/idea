import { test } from 'node:test'
import assert from 'node:assert/strict'
import { QueueOverflowError, TaskQueue } from '../src/renderer/src/task-queue.ts'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = () => new Promise((r) => setImmediate(r))

test('runs at most `concurrency` jobs at once, in order', async () => {
  const q = new TaskQueue(2, 10)
  const started: number[] = []
  const gates = [0, 1, 2, 3].map(() => deferred<number>())
  const results = gates.map((g, i) =>
    q.run(() => {
      started.push(i)
      return g.promise
    })
  )
  await tick()
  assert.deepEqual(started, [0, 1])
  assert.deepEqual(q.size, { active: 2, waiting: 2 })
  gates[1].resolve(1)
  await tick()
  assert.deepEqual(started, [0, 1, 2])
  gates[0].resolve(0)
  gates[2].resolve(2)
  gates[3].resolve(3)
  assert.deepEqual(await Promise.all(results), [0, 1, 2, 3])
})

test('drops the oldest waiting job when the backlog is full', async () => {
  const q = new TaskQueue(1, 2)
  const gate = deferred<string>()
  const running = q.run(() => gate.promise)
  const a = q.run(async () => 'a')
  const b = q.run(async () => 'b')
  const c = q.run(async () => 'c')
  await assert.rejects(a, QueueOverflowError)
  gate.resolve('first')
  assert.equal(await running, 'first')
  assert.equal(await b, 'b')
  assert.equal(await c, 'c')
})

test('a failing job does not stall the queue', async () => {
  const q = new TaskQueue(1, 5)
  const bad = q.run(async () => {
    throw new Error('boom')
  })
  const good = q.run(async () => 'ok')
  await assert.rejects(bad, /boom/)
  assert.equal(await good, 'ok')
  assert.deepEqual(q.size, { active: 0, waiting: 0 })
})
