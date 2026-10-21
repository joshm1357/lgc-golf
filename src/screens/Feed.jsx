import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { sendOrQueue } from '../lib/outbox.js';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useRealtime, useSession, playerName } from '../lib/store.jsx';
import { Header, Avatar, Icon, Sheet, timeAgo, toast, PhotoButtons } from '../components/ui.jsx';
import { DinnerAwardsLink } from '../components/DinnerAwardsLink.jsx';

const REACTIONS = ['🔥', '😂', '👏', '🤦', '🍺'];

export default function Feed() {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const [posts, setPosts] = useState([]);
  const [comments, setComments] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [composing, setComposing] = useState(false);
  const [limit, setLimit] = useState(40);

  const load = useCallback(async () => {
    const { data: ps } = await supabase.from('posts').select('*').order('created_at', { ascending: false }).limit(limit);
    const ids = (ps || []).map((p) => p.id);
    const [c, r] = ids.length
      ? await Promise.all([
          supabase.from('comments').select('*').in('post_id', ids).order('created_at'),
          supabase.from('reactions').select('*').in('post_id', ids),
        ])
      : [{ data: [] }, { data: [] }];
    setPosts(ps || []);
    setComments(c.data || []);
    setReactions(r.data || []);
  }, [limit]);

  useEffect(() => { load(); }, [load]);
  useRealtime(['posts', 'comments', 'reactions'], load);

  async function toggleReact(post, emoji) {
    const mine = reactions.find((r) => r.post_id === post.id && r.player_id === me && r.emoji === emoji);
    // Optimistic update so taps feel instant.
    setReactions((rs) => mine ? rs.filter((r) => r !== mine) : [...rs, { post_id: post.id, player_id: me, emoji }]);
    const q = mine
      ? supabase.from('reactions').delete().match({ post_id: post.id, player_id: me, emoji })
      : supabase.from('reactions').insert({ post_id: post.id, player_id: me, emoji });
    const { error } = await q;
    if (error) { toast(friendlyError(error)); load(); }
  }

  return (
    <div className="page">
      <Header
        logo title="The Feed" sub={data.liveRound ? `${data.liveRound.name} · live` : data.currentTrip?.name}
        right={<button type="button" className="btn gold sm" onClick={() => setComposing(true)}>{Icon.camera(18)}<span>Post</span></button>}
      />
      <div className="section stack">
        <DinnerAwardsLink />
        {!posts.length && <div className="empty">Nothing yet. Birdies, photos and Tribunal news will show up here.</div>}
        {posts.map((p) => (
          <Post key={p.id} post={p} me={me}
            comments={comments.filter((c) => c.post_id === p.id)}
            reactions={reactions.filter((r) => r.post_id === p.id)}
            onReact={(e) => toggleReact(p, e)} onChanged={load} isAdmin={status.is_admin} />
        ))}
        {posts.length >= limit && <button type="button" className="btn ghost" onClick={() => setLimit(limit + 40)}>Load older posts</button>}
      </div>
      {composing && <Composer onClose={() => setComposing(false)} onPosted={load} />}
    </div>
  );
}

function Post({ post, me, comments, reactions, onReact, onChanged, isAdmin }) {
  const data = useData();
  const author = post.player_id ? data.playersById[post.player_id] : null;
  const [text, setText] = useState('');
  const [showAll, setShowAll] = useState(false);
  const counts = REACTIONS.map((e) => ({ e, n: reactions.filter((r) => r.emoji === e).length, mine: reactions.some((r) => r.emoji === e && r.player_id === me) }));
  const auto = post.kind !== 'user';
  const shown = showAll ? comments : comments.slice(-2);

  async function comment(e) {
    e.preventDefault();
    if (!text.trim()) return;
    const { error } = await supabase.from('comments').insert({ post_id: post.id, player_id: me, body: text.trim() });
    if (error) toast(friendlyError(error));
    else { setText(''); onChanged(); }
  }

  return (
    <article className="card post">
      <div className="row pad">
        {auto ? (
          <span className="av" style={{ width: 38, height: 38, background: post.kind === 'tribunal' ? 'var(--court)' : 'var(--navy)', color: 'var(--gold)' }}>
            {post.kind === 'tribunal' ? Icon.gavel(18) : Icon.flag(18)}
          </span>
        ) : <Link to={`/player/${author?.id}`}><Avatar player={author} size={38} /></Link>}
        <div className="grow">
          {!auto && <div style={{ fontWeight: 700 }}>{playerName(author)}</div>}
          {auto && post.body && <div style={{ fontWeight: 600, fontSize: 16, lineHeight: 1.3 }}>{post.body}</div>}
          <div className="small muted">
            {post.kind === 'auto' ? 'Scoreboard · ' : post.kind === 'tribunal' ? 'Tribunal · ' : ''}
            {post.hole ? `Hole ${post.hole} · ` : ''}{timeAgo(post.created_at)}
          </div>
        </div>
        {post.link && <Link to={post.link} className="btn sm">{post.kind === 'tribunal' ? 'Case' : 'Open'}</Link>}
        {!auto && (post.player_id === me || isAdmin) && (
          <button type="button" className="btn ghost sm" aria-label="Delete post" onClick={async () => {
            if (!window.confirm('Delete this post?')) return;
            const { error } = await supabase.from('posts').delete().eq('id', post.id);
            if (error) toast(friendlyError(error)); else onChanged();
          }}>{Icon.x(16)}</button>
        )}
      </div>
      {post.photo_url && <img className="post-photo" src={post.photo_url} alt={post.body || 'Photo from the course'} loading="lazy" />}
      <div className="pad stack" style={{ paddingTop: post.photo_url ? 10 : 0 }}>
        {!auto && post.body && <div style={{ fontSize: 16, lineHeight: 1.4 }}>{post.body}</div>}
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {counts.map((c) => (
            <button key={c.e} type="button" className="react" aria-pressed={c.mine} onClick={() => onReact(c.e)} aria-label={`React ${c.e}`}>
              <span>{c.e}</span>{c.n > 0 && <span>{c.n}</span>}
            </button>
          ))}
        </div>
        {comments.length > 2 && !showAll && (
          <button type="button" className="small muted" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left' }} onClick={() => setShowAll(true)}>View all {comments.length} comments</button>
        )}
        {shown.map((c) => (
          <div key={c.id} style={{ fontSize: 15, lineHeight: 1.35 }}>
            <strong>{playerName(data.playersById[c.player_id])}</strong> {c.body}
          </div>
        ))}
        <form onSubmit={comment} className="row">
          <label className="grow">
            <span className="visually-hidden" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Write a comment</span>
            <input className="input" style={{ minHeight: 40, borderRadius: 999, background: 'var(--ground)' }} placeholder="Add a comment…" value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          {text.trim() && <button className="btn sm">Send</button>}
        </form>
      </div>
    </article>
  );
}

function Composer({ onClose, onPosted }) {
  const data = useData();
  const { status } = useSession();
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [hole, setHole] = useState('');
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  async function post() {
    setBusy(true);
    try {
      const r = data.liveRound;
      const res = await sendOrQueue('posts', {
        kind: 'user', player_id: status.player_id, body: text.trim() || null, photo_url: null,
        hole: hole ? Number(hole) : null, round_id: r?.id || null, trip_id: r?.trip_id || data.currentTrip?.id || null,
      }, { photo: file ? { file, field: 'photo_url', folder: 'feed' } : null });
      if (!res.sent) toast('No signal — saved on your phone, it’ll post when signal’s back');
      onPosted();
      onClose();
    } catch (e) {
      toast(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="New post" onClose={onClose}>
      <div className="stack">
        {preview && <img src={preview} alt="" style={{ width: '100%', display: 'block', borderRadius: 12 }} />}
        <PhotoButtons onPick={setFile} picked={!!file} cameraLabel={file ? 'Retake' : 'Take a photo'} />
        <textarea className="textarea" placeholder="Say something…" value={text} onChange={(e) => setText(e.target.value)} />
        <label className="field"><span>Hole (optional)</span><input className="input" inputMode="numeric" value={hole} onChange={(e) => setHole(e.target.value.replace(/\D/g, '').slice(0, 2))} /></label>
        <button type="button" className="btn gold block" disabled={busy || (!text.trim() && !file)} onClick={post}>{busy ? 'Posting…' : 'Post to the feed'}</button>
      </div>
    </Sheet>
  );
}
