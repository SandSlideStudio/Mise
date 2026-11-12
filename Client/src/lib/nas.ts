/** An http:// address sends the NAS password readable to anyone on the network. */
export function isPlainHttp(url: string): boolean {
  return /^http:\/\//i.test(url.trim());
}
