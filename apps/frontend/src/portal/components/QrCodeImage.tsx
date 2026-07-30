interface QrCodeImageProps {
  value?: string | null;
  size?: number;
  alt?: string;
}

export function QrCodeImage({ value, size = 220, alt = 'Payment QR code' }: QrCodeImageProps) {
  if (!value) {
    return (
      <div className="w-full aspect-square rounded-xl border border-dashed border-border bg-muted flex items-center justify-center text-sm text-muted-foreground">
        QR unavailable
      </div>
    );
  }

  const src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}`;

  return (
    <img
      src={src}
      alt={alt}
      className="w-full aspect-square rounded-xl border border-border bg-card object-contain"
    />
  );
}
