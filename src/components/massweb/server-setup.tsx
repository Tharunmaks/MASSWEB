import { CheckCircle2, Server } from "lucide-react";
import { useState } from "react";
import { STATIC_APP, savedServer, serverBase, setServer, testServer } from "@/lib/browser/server";
import { toast } from "@/lib/browser/toast";

/** First run of the GitHub Pages app: connect it to the Mass Web page server (your Vercel deploy). */
export function ConnectServer({ onConnected }: { onConnected: () => void }) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<{ busy: boolean; message: string; ok: boolean }>({ busy: false, message: "", ok: false });
  return (
    <div className="flex h-dvh items-center justify-center overflow-y-auto bg-paper px-5 py-10 text-ink">
      <form
        className="mw-rise w-full max-w-md"
        onSubmit={async (event) => {
          event.preventDefault();
          setState({ busy: true, message: "", ok: false });
          const result = await testServer(url);
          setState({ busy: false, message: result.message, ok: result.ok });
          if (result.ok) {
            setServer(url);
            setTimeout(onConnected, 500);
          }
        }}
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ink text-paper">
          <Server className="h-7 w-7" />
        </span>
        <h1 className="mt-5 font-serif text-[2rem] leading-tight font-semibold tracking-tight">Connect Mass Web</h1>
        <p className="mt-2 text-[15px] text-mute">
          This app runs on GitHub Pages. It loads websites through your own Mass Web server, so paste your server's address once. It's the address Vercel gave your project.
        </p>
        <label className="mt-6 block">
          <span className="text-sm text-mute">Server address</span>
          <input
            autoFocus
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="massweb.vercel.app"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="mt-1 h-13 w-full rounded-2xl bg-card px-4 py-3 text-base shadow-ring outline-none focus:ring-2 focus:ring-cobalt"
          />
        </label>
        {state.message ? (
          <p className={`mt-2 flex items-center gap-1.5 text-sm ${state.ok ? "text-good" : "text-ember"}`} role="status">
            {state.ok ? <CheckCircle2 className="h-4 w-4" /> : null}
            {state.message}
          </p>
        ) : null}
        <button type="submit" disabled={state.busy || !url.trim()} className="mw-press mt-5 h-13 w-full rounded-full bg-ink py-3.5 text-[15px] font-medium text-paper disabled:opacity-40">
          {state.busy ? "Checking…" : "Connect"}
        </button>
        <p className="mt-4 text-xs text-mute">The address is saved on this phone only. You can change it later in Settings → Page server.</p>
      </form>
    </div>
  );
}

/** Settings section for changing the server address (only shown in the static app, or when one is saved). */
export function ServerSettings() {
  const [url, setUrl] = useState(savedServer() || serverBase());
  const [busy, setBusy] = useState(false);
  if (!STATIC_APP && !savedServer()) return null;
  return (
    <form
      className="flex gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        const result = await testServer(url);
        setBusy(false);
        if (result.ok) {
          setServer(url);
          toast("Server saved. Reloading…");
          setTimeout(() => window.location.reload(), 600);
        } else toast(result.message);
      }}
    >
      <input
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="massweb.vercel.app"
        inputMode="url"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="Page server address"
        className="h-11 min-w-0 flex-1 rounded-xl bg-stone px-3 text-[15px] outline-none focus:ring-2 focus:ring-cobalt"
      />
      <button type="submit" disabled={busy} className="mw-press h-11 shrink-0 rounded-xl bg-ink px-4 text-sm text-paper disabled:opacity-50">
        {busy ? "…" : "Save"}
      </button>
    </form>
  );
}
