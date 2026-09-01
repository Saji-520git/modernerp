import { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';

// ─── AuthImage ────────────────────────────────────────────────────────────────
//
// Fetches an image with the Bearer token and shows it through an object URL.
//
// A plain <img src="/uploads/..."> cannot carry an Authorization header, so it
// gets a 401 from the authenticated download route and silently renders
// nothing. Anything pointing at /uploads must go through here.
//
// Shared rather than per-page: this logic lived only inside AttachmentPanel,
// so the thermal receipt used a plain <img> for the business logo and the logo
// never appeared on it.

interface AuthImageProps {
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  /** Render nothing at all when the fetch fails, instead of an empty box. */
  hideOnError?: boolean;
}

export default function AuthImage({
  src,
  alt,
  className,
  style,
  onClick,
  hideOnError = false,
}: AuthImageProps) {
  const [url, setUrl] = useState<string>('');
  const [failed, setFailed] = useState(false);
  const token = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    let objectUrl = '';
    let cancelled = false;
    setFailed(false);

    fetch(src, { headers: { Authorization: `Bearer ${token ?? ''}` } })
      // A 401/404 still resolves, and calling .blob() on it yields the error
      // body — which renders as a broken image rather than nothing. Reject
      // explicitly so the failure path is taken.
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (cancelled) return;
        setUrl('');
        setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, token]);

  if (failed && hideOnError) return null;

  return url
    ? <img src={url} alt={alt} className={className} style={style} onClick={onClick} />
    : <div className={className} style={style} />;
}
