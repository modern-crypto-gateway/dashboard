/**
 * Minimal HTTP helpers — JSON responses, error shape, body parsing.
 */

export interface ApiErrorShape {
  error: { code: string; message: string; details?: unknown }
}

export function json<T>(body: T, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  return new Response(JSON.stringify(body), { ...init, headers })
}

export function error(
  code: string,
  message: string,
  status = 400,
  details?: unknown,
): Response {
  const body: ApiErrorShape = { error: { code, message, details } }
  return json(body, { status })
}

export async function readJson<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw new HttpError(400, 'BAD_JSON', 'Malformed JSON body')
  }
}

export class HttpError extends Error {
  status: number
  code: string
  details?: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export function toResponse(err: unknown): Response {
  if (err instanceof HttpError) return error(err.code, err.message, err.status, err.details)
  console.error('unhandled', err)
  return error('INTERNAL', 'Internal error', 500)
}
