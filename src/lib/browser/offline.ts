import { serverBase } from "@/lib/browser/server";
/** Saved-for-offline articles, kept in IndexedDB on the phone. */
export type Article = {
  url: string;
  title: string;
  byline: string;
  siteName: string;
  excerpt: string;
  lang: string;
  html: string;
  words: number;
  minutes: number;
};

export type SavedArticle = Article & { savedAt: number };

const DB = "massweb";
const STORE = "saved";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "url" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveArticle(article: Article): Promise<void> {
  await run("readwrite", (store) => store.put({ ...article, savedAt: Date.now() }));
}

export async function listSaved(): Promise<SavedArticle[]> {
  try {
    const all = await run<SavedArticle[]>("readonly", (store) => store.getAll() as IDBRequest<SavedArticle[]>);
    return all.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function getSaved(url: string): Promise<SavedArticle | undefined> {
  try {
    return await run<SavedArticle | undefined>("readonly", (store) => store.get(url) as IDBRequest<SavedArticle | undefined>);
  } catch {
    return undefined;
  }
}

export async function removeSaved(url: string): Promise<void> {
  await run("readwrite", (store) => store.delete(url));
}

export async function fetchArticle(url: string): Promise<Article> {
  const res = await fetch(`${serverBase()}/reader?u=${encodeURIComponent(url)}`);
  const data = (await res.json()) as Article | { error: string };
  if (!res.ok || "error" in data) throw new Error("error" in data ? data.error : "Reader view failed.");
  return data;
}
