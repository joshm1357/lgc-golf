// "The AI is working" line (Josh, 22 Oct: "show that it hasn't just frozen"). Moving dots, a seconds counter, and a
// status that changes every few seconds; after 25 s it says big plans can take up to a minute.
import React, { useEffect, useState } from 'react';
import { thinkingLine } from '../lib/thinking.js';

export default function Thinking({ steps }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="thinking" role="status" aria-live="polite" data-testid="ai-thinking">
      <span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>
      <span className="grow">{thinkingLine(secs, steps)}</span>
      <span className="small muted num">{secs}s</span>
    </div>
  );
}
