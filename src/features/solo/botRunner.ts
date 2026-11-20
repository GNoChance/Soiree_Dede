/**
 * Lance un calcul dans le Web Worker du solo (un seul worker, partagé) : coup du bot ou
 * analyse de fin de partie. Repli sur un calcul direct si le worker est indisponible,
 * renvoie une erreur ou ne répond pas à temps.
 */
import type { BotJobInput } from './bot.worker'

type Reply = Record<string, unknown> & { id: number; error?: string }

let worker: Worker | null | undefined
let seq = 0
const waiting = new Map<number, (r: Reply | { error: string }) => void>()

function getWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('./bot.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<Reply>) => {
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

/** Résultat du worker (`pick` en extrait la réponse utile, undefined = invalide) ; `fallback` en cas de souci. */
export function runJob<R>(job: BotJobInput, pick: (r: Reply) => R | undefined, fallback: () => R | Promise<R>, timeoutMs = 4000): Promise<R> {
  const w = getWorker()
  if (!w) return Promise.resolve().then(fallback)
  const id = ++seq
  return new Promise<R>((resolve) => {
    const timer = window.setTimeout(() => {
      waiting.delete(id)
      void Promise.resolve().then(fallback).then(resolve)
    }, timeoutMs)
    waiting.set(id, (r) => {
      window.clearTimeout(timer)
      const v = r.error !== undefined ? undefined : pick(r as Reply)
      if (v === undefined) void Promise.resolve().then(fallback).then(resolve)
      else resolve(v)
    })
    w.postMessage({ ...job, id })
  })
}

/** Coup du bot calculé dans le worker ({ move, learned? }). */
export function runInWorker<C extends { move: unknown }>(job: BotJobInput, fallback: () => C | Promise<C>, timeoutMs = 4000): Promise<C> {
  return runJob<C>(job, (r) => (r.move === undefined ? undefined : ({ move: r.move, ...(r.learned ? { learned: r.learned } : {}) } as unknown as C)), fallback, timeoutMs)
}
