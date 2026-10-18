// Load a screen only when it's opened, so the leaderboard starts fast on weak signal.
// The service worker saves every part of the app in the background for offline use.
//
// If a part can't be fetched (usually because a new version went live and the old file is gone),
// reload the page once to pick up the new version. The flag stops a reload loop when there's
// genuinely no signal — then the error shows instead.
import React, { Component, Suspense, lazy } from 'react';

const FLAG = 'lgc-chunk-reload';

export function lazyScreen(load, name = 'default') {
  return lazy(async () => {
    try {
      const mod = await load();
      try { sessionStorage.removeItem(FLAG); } catch { /* ignore */ }
      return name === 'default' ? mod : { default: mod[name] };
    } catch (e) {
      let tried = false;
      try { tried = sessionStorage.getItem(FLAG) === '1'; sessionStorage.setItem(FLAG, '1'); } catch { /* ignore */ }
      if (!tried && typeof navigator !== 'undefined' && navigator.onLine !== false) {
        window.location.reload();
        return new Promise(() => {}); // wait for the reload
      }
      throw e;
    }
  });
}

/** If a screen can't load (no signal and never saved), say so instead of a blank page. */
class LoadBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false }); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="empty stack" style={{ gap: 12 }}>
        <div>Couldn’t open this screen — it hasn’t been saved on this phone yet and there’s no signal.</div>
        <button type="button" className="btn gold" onClick={() => window.location.reload()}>Try again</button>
      </div>
    );
  }
}

/** Wrap lazily loaded screens: a loading message while fetching, a friendly message if it fails. */
export function LazyArea({ children, resetKey, fallback = null }) {
  return (
    <LoadBoundary resetKey={resetKey}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </LoadBoundary>
  );
}
