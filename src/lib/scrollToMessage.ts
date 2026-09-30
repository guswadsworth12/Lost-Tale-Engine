/** Anchor id used by MessageBubble's root element — shared with search/pinned-message "jump to" actions. */
export function messageAnchorId(messageId: string): string {
  return `msg-${messageId}`
}

export function scrollToMessage(container: HTMLElement | null | undefined, messageId: string): void {
  const el = container?.querySelector<HTMLElement>(`#${CSS.escape(messageAnchorId(messageId))}`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/** A jump to a message in another chat (from the Gallery), taken once that chat has the message loaded. */
let pendingJump: { chatId: string; messageId: string } | null = null

export function requestMessageJump(chatId: string, messageId: string): void {
  pendingJump = { chatId, messageId }
}

/** The message to jump to in `chatId`, once `has` says it has loaded; cleared as it is taken. */
export function takeMessageJump(chatId: string, has: (messageId: string) => boolean): string | undefined {
  if (!pendingJump || pendingJump.chatId !== chatId || !has(pendingJump.messageId)) return undefined
  const { messageId } = pendingJump
  pendingJump = null
  return messageId
}
