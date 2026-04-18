import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { Session, SetupStatus } from './types'

export const sessionQuery = {
  queryKey: ['session'] as const,
  queryFn: () => api<Session>('/api/auth/session'),
  staleTime: 30_000,
}

export const setupStatusQuery = {
  queryKey: ['setup-status'] as const,
  queryFn: () => api<SetupStatus>('/api/auth/setup-status'),
  staleTime: 5_000,
}

export function useSession() {
  return useQuery(sessionQuery)
}

export function useSetupStatus() {
  return useQuery(setupStatusQuery)
}
