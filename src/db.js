import { openDB } from 'idb'

const database = openDB('dayly-database', 1, {
  upgrade(db) {
    for (const name of ['tasks', 'projects', 'ideas', 'reviews', 'settings']) {
      if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' })
    }
  },
})

export async function readAll() {
  const db = await database
  const [tasks, projects, ideas, reviews, settings] = await Promise.all(['tasks', 'projects', 'ideas', 'reviews', 'settings'].map(name => db.getAll(name)))
  return { tasks, projects, ideas, reviews, settings }
}

export async function put(store, value) { return (await database).put(store, value) }
export async function remove(store, id) { return (await database).delete(store, id) }
export async function replaceAll(data) {
  const db = await database
  const tx = db.transaction(['tasks', 'projects', 'ideas', 'reviews', 'settings'], 'readwrite')
  for (const store of ['tasks', 'projects', 'ideas', 'reviews', 'settings']) {
    await tx.objectStore(store).clear()
    for (const row of data[store] || []) await tx.objectStore(store).put(row)
  }
  await tx.done
}
