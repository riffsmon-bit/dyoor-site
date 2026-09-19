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
    // A gateway can accept the request and then stall (the self-hosted gateway
    // does this while a CID is not pinned). Keep the immutable public fallback
    // available instead of leaving the card blank indefinitely. The browser's
    // own lazy-loading still controls when the request starts.
    if (loaded || index >= sources.length - 1) return;
    const timer = window.setTimeout(() => setIndex((value) => value + 1), 3500);
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
