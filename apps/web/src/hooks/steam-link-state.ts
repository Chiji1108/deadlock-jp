import type { steamAction } from '../server/steam.functions'
import type { SteamCandidate } from '../server/steam-admin'

type Reply = Awaited<ReturnType<typeof steamAction>>
export type Preview = Extract<
  Extract<Reply, { ok: true }>['result'],
  { kind: 'preview' | 'unlink-preview' }
>
export type Method = 'search' | 'match' | 'direct'
export type Operation =
  'search' | 'match' | 'preview' | 'unlink-preview' | 'save'
type Screen =
  | { kind: 'closed' | 'editing' }
  | { kind: 'confirming'; preview: Preview; selected: SteamCandidate | null }
export interface SteamLinkState {
  screen: Screen
  pending: Operation | null
  method: Method
  value: string
  candidates: SteamCandidate[] | null
  error: string
  notice: string
}
export const initialSteamLinkState: SteamLinkState = {
  screen: { kind: 'closed' },
  pending: null,
  method: 'search',
  value: '',
  candidates: null,
  error: '',
  notice: '',
}
type Event =
  | { type: 'open'; open: boolean }
  | { type: 'method'; method: Method }
  | { type: 'value'; value: string }
  | { type: 'start'; operation: Operation; clearCandidates: boolean }
  | { type: 'candidates'; candidates: SteamCandidate[] }
  | { type: 'preview'; preview: Preview; selected: SteamCandidate | null }
  | { type: 'saved'; notice: string }
  | { type: 'error'; error: string }
  | { type: 'notice'; notice: string }
  | { type: 'back' | 'finish' }
export function steamLinkReducer(
  state: SteamLinkState,
  event: Event,
): SteamLinkState {
  switch (event.type) {
    case 'open':
      if (state.pending || state.screen.kind === 'confirming') return state
      return event.open
        ? {
            ...state,
            screen: { kind: 'editing' },
            value: '',
            candidates: null,
            error: '',
            notice: '',
          }
        : { ...state, screen: { kind: 'closed' } }
    case 'method':
      return state.pending
        ? state
        : {
            ...state,
            method: event.method,
            value: '',
            candidates: null,
            error: '',
          }
    case 'value':
      return state.pending ? state : { ...state, value: event.value }
    case 'start':
      return {
        ...state,
        pending: event.operation,
        error: '',
        candidates: event.clearCandidates ? null : state.candidates,
      }
    case 'candidates':
      return { ...state, candidates: event.candidates }
    case 'preview':
      return {
        ...state,
        screen: {
          kind: 'confirming',
          preview: event.preview,
          selected: event.selected,
        },
      }
    case 'saved':
      return { ...state, screen: { kind: 'closed' }, notice: event.notice }
    case 'error':
      return { ...state, error: event.error }
    case 'notice':
      return { ...state, notice: event.notice }
    case 'back':
      return state.pending
        ? state
        : { ...state, screen: { kind: 'editing' }, error: '' }
    case 'finish':
      return { ...state, pending: null }
  }
}
