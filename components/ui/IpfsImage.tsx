"use client";

import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { ipfsGatewayUrls } from "@/lib/ipfs-gateway";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src?: string };

// Remount retry state when a reroll changes the image, including data-URL previews.
export function IpfsImage(props: Props) {
  return <GatewayImage key={props.src} {...props} />;
}

function GatewayImage({ src, onError, onLoad, alt, ...props }: Props) {
  const sources = ipfsGatewayUrls(src);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const current = sources[index];

  useEffect(() => {
    // Lazy images should not exhaust retries before they enter the viewport.
    if (loaded || props.loading === "lazy" || index >= sources.length - 1) return;
    const timer = window.setTimeout(() => setIndex((value) => value + 1), 12000);
    return () => window.clearTimeout(timer);
  }, [index, loaded, props.loading, sources.length]);

  if (!current) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      key={current}
      alt={alt}
      src={current}
      onLoad={(event) => { setLoaded(true); onLoad?.(event); }}
      onError={(event) => {
        if (index < sources.length - 1) setIndex(index + 1);
        else onError?.(event);
      }}
    />
  );
}
