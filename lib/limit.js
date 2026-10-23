/**
 * Runs tasks with at most `max` of them in progress at once. A task that
 * throws gives its error to the caller that queued it and frees its place.
 *
 * @param {number} max
 * @returns {<T>(task: () => Promise<T>) => Promise<T>}
 */
export function createLimiter(max) {
  /** @type {Array<() => void>} */
  const waiting = [];
  let active = 0;

  function startNext() {
    if (active >= max) return;
    const start = waiting.shift();
    if (start) start();
  }

  return (task) =>
    new Promise((resolve, reject) => {
      waiting.push(() => {
        active += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            startNext();
          });
      });
      startNext();
    });
}

/**
 * Wraps a client so every call, including a whole paged listing, takes one
 * place in the limiter.
 *
 * @param {import('./client.js').GiteaClient} client
 * @param {ReturnType<typeof createLimiter>} run
 * @returns {import('./client.js').GiteaClient}
 */
export function limitClient(client, run) {
  return {
    request: (method, path, options) => run(() => client.request(method, path, options)),
    paginate: (path, options) => run(() => client.paginate(path, options)),
  };
}
