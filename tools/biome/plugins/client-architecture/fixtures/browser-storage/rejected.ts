export function RejectedBrowserStorage() {
  const persistent = window.localStorage.getItem('fixture.persistent');
  const transient = window.sessionStorage.getItem('fixture.transient');
  return {persistent, transient};
}
