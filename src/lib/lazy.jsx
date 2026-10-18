// Load a screen only when it's opened, so the leaderboard starts fast on weak signal.
// The service worker saves every part of the app in the background for offline use.
//
// Whole screens: if a part can't be fetched (usually because a new version went live and the old
// file is gone), reload the page once to pick up the new version. The flag stops a reload loop when
// there's genuinely no signal — then the message shows instead.
// Parts inside a screen (the draw ceremony, shot planner, draw set-up) never reload the page — that
// could throw away a score being typed — they just show a message with a Close button.
import React, { Component, Suspense, lazy } from 'react';

const FLAG = 'lgc-chunk-reload';
const LOAD_FAIL = /dynamically imported module|Importing a module script failed|Unable to preload CSS|Failed to fetch|Loading chunk|error loading dynamically/i;

export function lazyScreen(load, name = 'default', { inline = false } = {}) {
  return lazy(async () => {
    try {
      const mod = await load();
      try { sessionStorage.removeItem(FLAG); } catch { /* ignore */ }
      return name === 'default' ? mod : { default: mod[name] };
    } catch (e) {
      if (!inline) {
        let tried = false;
        try { tried = sessionStorage.getItem(FLAG) === '1'; sessionStorage.setItem(FLAG, '1'); } catch { /* ignore */ }
        if (!tried && typeof navigator !== 'undefined' && navigator.onLine !== false) {
          window.location.reload();
          return new Promise(() => {}); // wait for the reload
        }
      }
      throw e;
    }
  });
}

/** If a screen can't load or crashes, say what happened instead of a blank page. */
class LoadBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { quiet, onClose } = this.props;
    if (quiet) return null;
    const notLoaded = LOAD_FAIL.test(String(error?.message || error));
    return (
      <div className="empty stack" style={{ gap: 12 }}>
        <div>
          {notLoaded
            ? 'Couldn’t open this — it hasn’t been saved on this phone yet and there’s no signal.'
            : `Something went wrong on this screen: ${String(error?.message || error)}`}
        </div>
        {onClose
          ? <button type="button" className="btn ghost" onClick={onClose}>Close</button>
          : <button type="button" className="btn gold" onClick={() => window.location.reload()}>Try again</button>}
      </div>
    );
  }
}

/** Wrap lazily loaded parts: a loading message while fetching, a plain message if it fails.
 *  `quiet` shows nothing on failure (e.g. the draw watcher); `onClose` offers a Close button. */
export function LazyArea({ children, resetKey, fallback = null, quiet = false, onClose }) {
  return (
    <LoadBoundary resetKey={resetKey} quiet={quiet} onClose={onClose}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </LoadBoundary>
  );
}
