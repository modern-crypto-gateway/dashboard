/**
 * Tiny method+path router for the worker. Supports literal paths plus `*`
 * tail captures (e.g. `/api/gw/*`).
 */

import type { Bindings } from './env'
import { error, HttpError, toResponse } from './http'

export type Handler = (
  req: Request,
  env: Bindings,
  ctx: ExecutionContext,
  params: { tail?: string },
) => Promise<Response> | Response

interface Route {
  method: string
  path: string
  handler: Handler
  hasTail: boolean
}

export class Router {
  private routes: Route[] = []

  get(path: string, handler: Handler) {
    return this.add('GET', path, handler)
  }
  post(path: string, handler: Handler) {
    return this.add('POST', path, handler)
  }
  delete(path: string, handler: Handler) {
    return this.add('DELETE', path, handler)
  }
  patch(path: string, handler: Handler) {
    return this.add('PATCH', path, handler)
  }
  put(path: string, handler: Handler) {
    return this.add('PUT', path, handler)
  }
  any(path: string, handler: Handler) {
    return this.add('*', path, handler)
  }

  private add(method: string, path: string, handler: Handler) {
    const hasTail = path.endsWith('/*')
    this.routes.push({
      method,
      path: hasTail ? path.slice(0, -2) : path,
      handler,
      hasTail,
    })
    return this
  }

  async handle(req: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    const method = req.method

    for (const r of this.routes) {
      if (r.method !== '*' && r.method !== method) continue
      if (r.hasTail) {
        if (path === r.path || path.startsWith(r.path + '/')) {
          const tail = path.slice(r.path.length).replace(/^\//, '')
          try {
            return await r.handler(req, env, ctx, { tail })
          } catch (e) {
            return toResponse(e)
          }
        }
      } else if (path === r.path) {
        try {
          return await r.handler(req, env, ctx, {})
        } catch (e) {
          return toResponse(e)
        }
      }
    }
    return error('NOT_FOUND', 'Not found', 404)
  }
}

export { HttpError }
