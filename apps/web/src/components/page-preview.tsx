'use client';

import { useEffect, useRef, useState } from 'react';

const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;

/**
 * Show a full A4 page scaled to whatever width is available.
 *
 * The iframe is always rendered at true A4 pixel size so the document inside
 * lays out exactly as it will print; only the presentation is scaled. Scaling
 * the iframe's own width instead would reflow the content and the preview
 * would stop matching the PDF.
 */
export function PagePreview({ html, title }: { html: string; title: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const measure = () => {
      const available = element.clientWidth - 24;
      setScale(Math.min(1, Math.max(0.3, available / A4_WIDTH_PX)));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="h-full w-full overflow-auto bg-surface-muted p-3 sm:p-4">
      <div
        className="mx-auto"
        dir="ltr"
        style={{ width: A4_WIDTH_PX * scale, height: A4_HEIGHT_PX * scale }}
      >
        <iframe
          title={title}
          srcDoc={html}
          sandbox=""
          style={{
            width: A4_WIDTH_PX,
            height: A4_HEIGHT_PX,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
          className="block rounded-xs border-0 bg-white shadow-lg ring-1 ring-border"
        />
      </div>
    </div>
  );
}
