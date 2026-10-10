'use client';

import JsBarcode from 'jsbarcode';
import { useEffect, useRef } from 'react';

/** EAN-13 when the value is a valid 13-digit code, Code 128 for anything else. */
export function isEan13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  const sum = [...value.slice(0, 12)].reduce((acc, digit, i) => acc + Number(digit) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === Number(value[12]);
}

/** Renders a scannable barcode as inline SVG, sized by its container. */
export function Barcode({
  value,
  height = 40,
  showText = true,
  className,
}: {
  value: string;
  height?: number;
  showText?: boolean;
  className?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, {
        format: isEan13(value) ? 'EAN13' : 'CODE128',
        height,
        displayValue: showText,
        fontSize: 12,
        margin: 0,
        width: 2,
        background: 'transparent',
        lineColor: '#000',
      });
      // Let the SVG scale to its box instead of a fixed pixel width.
      ref.current.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      ref.current.removeAttribute('width');
      ref.current.removeAttribute('height');
    } catch {
      // Unencodable characters: leave the box empty rather than break the sheet.
    }
  }, [value, height, showText]);

  return <svg ref={ref} className={className} role="img" aria-label={value} />;
}
