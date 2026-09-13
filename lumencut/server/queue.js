let active = false;
const pending = [];

export function enqueue(fn) {
  return new Promise((resolve, reject) => {
    pending.push({ fn, resolve, reject });
    drain();
  });
}

async function drain() {
  if (active || !pending.length) return;
  active = true;
  const item = pending.shift();
  try { item.resolve(await item.fn()); } catch (error) { item.reject(error); }
  active = false;
  drain();
}
