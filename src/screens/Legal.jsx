import React from 'react';
import { GolfTripCrest } from '../components/Logo.jsx';

// Stage 9: privacy and terms — DRAFTS for Josh to check (not final, not legal advice). Public: #/privacy, #/terms.
// Written from what the app actually stores (see BUILD-STATUS, Stage 9). Things only Josh can decide are in [brackets].

function Page({ title, children }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #F4F5F7)' }}>
      <div style={{ background: 'var(--navy)', color: '#fff', padding: '22px 16px 18px' }}>
        <div className="row" style={{ gap: 12 }}>
          <GolfTripCrest size={48} />
          <div style={{ fontFamily: 'var(--display)', fontSize: 26, fontWeight: 700, lineHeight: 1.05 }}>{title}</div>
        </div>
      </div>
      <div className="stack legal" style={{ maxWidth: 640, margin: '0 auto', padding: 16, gap: 10, lineHeight: 1.5 }}>
        <div className="card pad small" role="note" style={{ borderColor: 'var(--gold)' }}>
          <strong>DRAFT — not final.</strong> Josh is still checking this. Words in [brackets] are still to be decided.
        </div>
        {children}
        <a href="#/" className="small">← Back to the app</a>
      </div>
    </div>
  );
}
const H = ({ children }) => <h2 style={{ fontSize: 19, margin: '10px 0 0' }}>{children}</h2>;
const P = ({ children }) => <p style={{ margin: 0 }}>{children}</p>;
const L = ({ items }) => <ul style={{ margin: 0, paddingLeft: 20 }}>{items.map((x, i) => <li key={i} style={{ marginBottom: 4 }}>{x}</li>)}</ul>;

export function Privacy() {
  return (
    <Page title="Privacy">
      <P><strong>Short version:</strong> your golf group sees what you put in the app. Nobody else does — not golf clubs, not
        advertisers. We don’t sell anything about you, there are no ads and no tracking. You can leave, delete your account,
        or (organisers) download and delete your group.</P>

      <H>Who runs it</H>
      <P>The Golf Trip is run by Josh [full name / business name, ABN if any]. Questions or requests: [contact email].</P>

      <H>What the app keeps, and who sees it</H>
      <L items={[
        <><strong>Signing in.</strong> You can start with no details at all (a “phone-only” sign-in). If you add Google or an
          email address, we keep that email so you can sign in again. Other players don’t see it; your group’s organisers see
          a shortened version (like m…@gmail.com) so they know you’ve signed in.</>,
        <><strong>Your profile in a group.</strong> Name, nickname, handicap and its history, a selfie if you take one, and
          any payment details you choose to add for the group (like a PayID). Everyone in that group sees these.</>,
        <><strong>Golf.</strong> Scores, teams, side comps (closest-to-the-pin and longest-drive entries include where on the
          course they were measured), honour board, trophies, the Rulebook and Tribunal, votes and comments. Your group sees them.</>,
        <><strong>Photos</strong> you post (feed, comps, Tribunal, the group’s crest). They’re stored at a web address that
          isn’t listed anywhere, but anyone who has the exact link can open it.</>,
        <><strong>Share pictures and results.</strong> When anyone in the group shares a winner, leaderboard or Tribunal
          picture (or the results text) to a chat, the names and scores on it go wherever they send it.</>,
        <><strong>Location — only if you switch on “Share my location”</strong> and have the map open. We keep only your
          latest position, your group sees it, and it’s removed when you switch sharing off or after a day without an
          update. Distances to the green are worked out on your phone and aren’t sent.</>,
        <><strong>Notifications</strong>, if you turn them on: your phone’s notification address, the phone type, your time
          zone and your settings. The text of a notification passes through Apple’s, Google’s or Mozilla’s notification
          service to reach your phone.</>,
        <><strong>Trip planning.</strong> Who’s in, polls, jobs, costs, who’s paid whom, rooms, cars and trip chat. Your group
          sees these. The app only keeps track — it never moves money.</>,
      ]} />

      <H>Golf clubs</H>
      <L items={[
        <>Clubs never see players’ names, scores or whereabouts. A partner club sees counts only: how many times its QR codes
          were scanned, and roughly how many rounds and groups started from them (fewer than 5 shows as “&lt;5”).</>,
        <><strong>Clubhouse TV</strong> only if your organiser ticks “Show on the clubhouse TV” for that round: first names or
          nicknames, handicaps and scores, on that day only, on the club’s screen. Anyone with the club’s TV link can see it.</>,
        <>If you work at a club and claim its page, Josh keeps the contact details you give so he can check the claim.</>,
      ]} />

      <H>Counting scans, and where groups come from</H>
      <P>When someone opens a club’s or a stay card’s QR code, we count it without knowing who it was: the phone keeps a random
        number, which is scrambled with the date before it’s stored. A group remembers which code or results card it started
        from (not who scanned it).</P>

      <H>Keeping the app safe and working</H>
      <L items={[
        <>Your internet address is used to stop abuse (too many tries, too many new groups). It’s scrambled with the date
          before it’s stored — except after a wrong PIN or invite code, when it’s kept as it is for up to 30 days to lock out
          guessing.</>,
        <>If the app breaks on your phone, it sends Josh the error, the screen it happened on (without any invite code or
          sign-in code), which group you were in, the app version and the phone type. No names. Kept for 90 days.</>,
        <>Supabase, which runs our database, keeps its own records of requests (including internet addresses) for a short
          time to run and protect its service.</>,
      ]} />

      <H>Other services the app uses</H>
      <L items={[
        <><strong>Supabase</strong> — the database, sign-in and photo storage [server location to confirm].</>,
        <><strong>[GitHub Pages / Vercel]</strong> — delivers the app to your phone.</>,
        <><strong>Google Fonts</strong> (the lettering) and <strong>Esri</strong> (satellite map pictures) — your phone fetches these directly.</>,
        <><strong>OpenStreetMap</strong> — course names and locations, and greens. If an organiser imports greens, the course’s
          location is sent to OpenStreetMap’s servers to look them up.</>,
        <><strong>Google or Facebook</strong> — only if you choose to sign in with them. The sign-in screen loads Google’s
          sign-in button from Google.</>,
        <><strong>Claude (Anthropic)</strong> — only if your group switches on the Claude connector: then the group’s names,
          handicaps, scores and plans can be read by Claude when your organiser asks it to. To improve the app, we log
          how it’s used only as counts (which group, which action, whether it worked) and one-line descriptions of jobs
          it couldn’t do yet — never the chat or what was asked.</>,
        <><strong>The AI helper</strong> — on for groups unless they switch it off (More → Group &amp; invites → Features). When
          someone asks it a question, sets up a trip or plans one with it, the question and the group’s golf data it needs
          (names, nicknames, handicaps, scores, trips, courses and honour boards) are sent to the AI company the app uses
          at the time (for example Anthropic, Moonshot or OpenRouter) to work out the answer. Guests don’t get it. We keep
          counts only — which group, which part of the app, how many words (tokens) it used, whether it worked and any
          👍 / 👎 — never the question or the answer.</>,
      ]} />
      <P>No advertising networks, no analytics or tracking tools, and nothing is sold.</P>

      <H>On your phone</H>
      <P>The app keeps a copy of your group’s data so it works with no signal, photos waiting to upload, and map pictures. Your
        browser’s “clear site data” removes them.</P>

      <H>How long things are kept, and deleting them</H>
      <L items={[
        <>Things stay until you, your organiser or Josh delete them. You can delete your own posts, comments and chat.</>,
        <><strong>Leave a group</strong> (Group &amp; invites → Your data): your scores stay in the group’s history; your location and
          notifications for that group go.</>,
        <><strong>Delete your account</strong>: you leave every group and your sign-in is removed. You can also have your name
          and selfie taken off your profile, the honour board and the app’s own feed posts (you’ll show as “Former
          player”). Things other people wrote that mention you aren’t changed.</>,
        <><strong>Organisers</strong> can download all of the group’s data (it includes everyone’s profile, so any payment
          details people added), or delete the whole group.</>,
        <>Photos of a deleted group or a removed selfie disappear from the app straight away; the files themselves are removed
          from storage by a clean-up that isn’t running yet [to come] — until then, someone who already has a photo’s exact
          link could still open it.</>,
        <>Scan counts are kept for 2 years; app problem reports for 90 days.</>,
        <>Anything else, or a copy of what we hold about you: email [contact email].</>,
      ]} />

      <H>Age</H>
      <P>The Golf Trip is for adults [age to confirm — 16 or 18 and over].</P>

      <H>Changes</H>
      <P>If this changes in a way that matters, the app will say so. Last updated: [date].</P>
    </Page>
  );
}

export function Terms() {
  return (
    <Page title="Terms">
      <P>The Golf Trip is a free app for running golf trips and rounds with your mates. By using it you agree to these terms.</P>
      <H>Your group, your stuff</H>
      <L items={[
        <>What you post belongs to you. You let the app store it and show it to your group (and, if your organiser chooses,
          first names and scores on a club’s TV that day).</>,
        <>Organisers run their group: who’s in, which features are on, and they can remove posts and people.</>,
        <>Only post photos of people who are OK with it. Keep it to friendly banter — no abuse, threats or anything illegal.
          Josh can remove content or groups that break this.</>,
      ]} />
      <H>Golf, handicaps and money</H>
      <L items={[
        <>Handicaps, scores and rulings in the app are for your group’s fun. They aren’t official Golf Australia handicaps.</>,
        <>The app keeps track of costs and who owes whom, but never holds or moves money. Sorting out money is between you and
          your mates.</>,
        <>Side comps and trophies are for bragging rights. Don’t use the app to run gambling.</>,
      ]} />
      <H>Golf clubs</H>
      <P>A club that claims its page must be authorised to act for the club. Hole data, offers and contact details it adds must
        be accurate. Partner courses are labelled; unclaimed courses are always listed too. Course details partly come from
        OpenStreetMap (© OpenStreetMap contributors).</P>
      <H>The app itself</H>
      <L items={[
        <>It’s provided as it is. We try to keep it working and your data safe, but can’t promise it’ll never be down or never
          lose anything — download your group’s data if it matters to you.</>,
        <>Nothing in these terms takes away rights you have under the Australian Consumer Law.</>,
        <>We may change or stop features. If we ever close the app, organisers get [notice period] to download their data.</>,
        <>These terms are under the law of [New South Wales], Australia.</>,
      ]} />
      <P>Questions: [contact email]. Last updated: [date].</P>
    </Page>
  );
}
