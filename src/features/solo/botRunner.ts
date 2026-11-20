/**
 * Lance un calcul de bot dans le Web Worker du solo (un seul worker, partagé), avec repli
 * sur un calcul direct si le worker est indisponible ou ne répond pas à temps.
 */
import type { BotJob } from './bot.worker'

let worker: Worker | null | undefined
let seq = 0
const waiting = new Map<number, (r: { move?: unknown; error?: string }) => void>()

function getWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('./bot.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; move?: unknown; error?: string }>) => {
      waiting.get(e.data.id)?.(e.data)
      waiting.delete(e.data.id)
    }
    worker.onerror = () => {
      worker?.terminate()
      worker = null
      for (const [, done] of waiting) done({ error: 'worker' })
      waiting.clear()
    }
  } catch {
    worker = null
  }
  return worker
}

/** Coup du bot calculé dans le worker ; `fallback` (calcul direct, plus court) en cas de souci. */
export function runInWorker<M>(job: Omit<BotJob, 'id'>, fallback: () => M | Promise<M>, timeoutMs = 4000): Promise<M> {
  const w = getWorker()
  if (!w) return Promise.resolve().then(fallback)
  const id = ++seq
  return new Promise<M>((resolve) => {
    const timer = window.setTimeout(() => {
      waiting.delete(id)
      void Promise.resolve().then(fallback).then(resolve)
    }, timeoutMs)
    waiting.set(id, (r) => {
      window.clearTimeout(timer)
      if (r.error !== undefined || r.move === undefined) void Promise.resolve().then(fallback).then(resolve)
      else resolve(r.move as M)
    })
    w.postMessage({ ...job, id } satisfies BotJob)
  })
}
