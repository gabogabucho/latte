/** Small tolerance keeps streaming pinned only while the reader follows the end. */
export function isNearConversationEnd(scrollTop: number, clientHeight: number, scrollHeight: number): boolean {
  return scrollHeight - clientHeight - scrollTop <= 64;
}
