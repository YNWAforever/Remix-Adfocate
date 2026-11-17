/** Provider login is a full-page navigation; isolated so tests can observe it. */
export function beginProviderLogin(url: string) {
  window.location.assign(url);
}
