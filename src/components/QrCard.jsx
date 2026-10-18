import React, { useEffect, useState } from 'react';

// A printable QR card (the club's kit, Josh's stay cards). The QR code is made on the phone — nothing is sent anywhere.

export function useQr(text) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let live = true;
    import('qrcode').then((QR) => QR.toDataURL(text, { margin: 1, width: 600, errorCorrectionLevel: 'M' })).then((u) => live && setUrl(u)).catch(() => {});
    return () => { live = false; };
  }, [text]);
  return url;
}

export function QrCard({ link, title, line, small }) {
  const qr = useQr(link);
  return (
    <div className="kit-card" style={{ border: '2px solid #1F4B33', borderRadius: 14, padding: 16, textAlign: 'center', background: '#fff', color: '#15202E', breakInside: 'avoid' }}>
      <div style={{ fontFamily: 'var(--display)', fontSize: small ? 22 : 30, fontWeight: 700, lineHeight: 1.1 }}>{title}</div>
      {qr && <img src={qr} alt={`QR code: ${title}`} style={{ width: small ? 150 : 200, height: small ? 150 : 200, margin: '10px auto', display: 'block' }} />}
      <div style={{ fontSize: small ? 14 : 16 }}>{line}</div>
      <div style={{ fontSize: 11, marginTop: 6, color: '#555' }}>The Golf Trip</div>
    </div>
  );
}

