import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function QR({ text, size = 220, dark = '#14110E', light = '#F5EFE4' }: { text: string; size?: number; dark?: string; light?: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark, light } }).then(setSvg);
  }, [text, dark, light]);
  return <div className="qr" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Join code shown as spaced characters: "K7P 4QX". */
export function Code({ code }: { code: string }) {
  return (
    <span className="code" aria-label={`Class code ${code.split('').join(' ')}`}>
      {code.slice(0, 3)}
      <span className="code__gap" />
      {code.slice(3)}
    </span>
  );
}
