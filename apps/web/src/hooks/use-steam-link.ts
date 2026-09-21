import { useReducer, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { steamAction } from '@/server/steam.functions'
import type { SteamCandidate } from '@/server/steam-admin'
import { initialSteamLinkState, steamLinkReducer } from './steam-link-state'
import type { Method, Operation } from './steam-link-state'

export function useSteamLink(twitchId: string) {
  const router = useRouter()
  const [state, dispatch] = useReducer(steamLinkReducer, initialSteamLinkState)
  // Protect against two events before React has rendered the pending state.
  const working = useRef(false)
  const preview =
    state.screen.kind === 'confirming' ? state.screen.preview : null
  async function request(
    action: Operation,
    input: string,
    candidate?: SteamCandidate,
    clearCandidates = false,
  ) {
    if (working.current) return
    working.current = true
    dispatch({ type: 'start', operation: action, clearCandidates })
    try {
      const reply = await steamAction({
        data: { action, twitchId, value: input },
      })
      if (!reply.ok) {
        dispatch({ type: 'error', error: reply.message })
        return
      }
      const result = reply.result
      if (result.kind === 'candidates')
        dispatch({ type: 'candidates', candidates: result.candidates })
      if (result.kind === 'preview' || result.kind === 'unlink-preview')
        dispatch({
          type: 'preview',
          preview: result,
          selected: candidate ?? null,
        })
      if (result.kind === 'saved') {
        dispatch({ type: 'saved' })
        const toastId = toast.success(
          preview?.kind === 'unlink-preview'
            ? 'Steamアカウントの紐付けを解除しました。'
            : 'Steamアカウントを紐付けました。',
        )
        try {
          await router.invalidate({ sync: true })
        } catch {
          toast.warning('保存しました。画面を再読み込みしてください。', {
            id: toastId,
            duration: Infinity,
            closeButton: true,
          })
        }
      }
    } catch {
      dispatch({
        type: 'error',
        error: '通信に失敗しました。再試行してください。',
      })
    } finally {
      working.current = false
      dispatch({ type: 'finish' })
    }
  }
  return {
    ...state,
    open: state.screen.kind === 'editing',
    preview,
    selected: state.screen.kind === 'confirming' ? state.screen.selected : null,
    busy: state.pending !== null,
    request,
    setOpen: (open: boolean) => {
      if (!working.current) dispatch({ type: 'open', open })
    },
    setMethod: (method: Method) => {
      if (!working.current) dispatch({ type: 'method', method })
    },
    setValue: (value: string) => dispatch({ type: 'value', value }),
    back: () => {
      if (!working.current) dispatch({ type: 'back' })
    },
    search: () =>
      request(
        state.method === 'direct' ? 'preview' : state.method,
        state.value,
        undefined,
        true,
      ),
  }
}
