/**
 * AvatarUpload.tsx
 *
 * Drop-in wrapper around <UserAvatar> that adds:
 *  1. Camera-icon hover overlay to trigger file picking
 *  2. A modal crop-and-zoom tool powered by react-easy-crop
 *  3. Uploads the cropped 256×256 WebP blob to the given uploadUrl
 *
 * All errors are surfaced via the `onError` callback — the parent is
 * responsible for rendering error UI so it doesn't clip outside cards.
 */

import { UserAvatar } from "@/components/UserAvatar";
import { Camera, Check, Image as ImageIcon, Loader2, RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Area } from "react-easy-crop";
import Cropper from "react-easy-crop";

/** Maximum stored resolution. Canvas is sized to the natural crop area capped
 *  at this value. The CDN serves exact sizes on demand via ?w=N. */
const MAX_OUTPUT_PX = 2048;

// ── Types ─────────────────────────────────────────────────────────────────────

interface AvatarUploadProps {
  src: string | null;
  name: string;
  size?: number;
  uploadUrl: string;
  onSuccess: (imageUrl: string) => void;
  onError?: (message: string) => void;
}

interface PickedImage {
  objectUrl: string;
  naturalW: number;
  naturalH: number;
}

// ── getCroppedImg — draws the react-easy-crop pixel area to a canvas ──────────
//
// NOTE: react-easy-crop's onCropComplete fires with pixelCrop coordinates that
// already account for the current rotation state — they are in the original
// image's coordinate space but describe the post-rotation crop window.
// We therefore do NOT apply any additional canvas rotation here; the Cropper
// component handles visual rotation internally and gives us the correct rect.
//
// The circle crop is PURELY CSS (border-radius: 50%). We upload a plain square
// JPEG/WebP with no alpha channel — smaller, sharper, and fully opaque.

async function getCroppedImg(imageSrc: string, pixelCrop: Area): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = imageSrc;
  });

  // Use the natural crop size, capped at MAX_OUTPUT_PX.
  // This preserves full source resolution (e.g. 1568 × 1568 stays 1568 × 1568)
  // so the CDN can serve any ?w= variant up to the original size.
  const outSize = Math.round(Math.min(MAX_OUTPUT_PX, pixelCrop.width, pixelCrop.height));

  const canvas = document.createElement("canvas");
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D not available");

  // Draw exactly the cropped region, scaled to outSize.
  // No clip path — circle cropping is done with CSS (border-radius: 50%).
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outSize,
    outSize,
  );

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/webp",
      0.92,
    ),
  );
}

// ── Crop modal ────────────────────────────────────────────────────────────────

function CropModal({
  picked,
  onConfirm,
  onCancel,
}: {
  picked: PickedImage;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const cropAreaRef = useRef<Area | null>(null);

  const handleReset = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
  };

  const handleRotate = () => setRotation((r) => (r + 90) % 360);

  const onCropComplete = useCallback((_: Area, pixelCrop: Area) => {
    cropAreaRef.current = pixelCrop;
  }, []);

  const handleConfirm = async () => {
    const pa = cropAreaRef.current;
    if (!pa) return;
    try {
      const blob = await getCroppedImg(picked.objectUrl, pa);
      onConfirm(blob);
    } catch {
      // Silently ignore — parent handles errors at the upload level
    }
  };

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        background: "var(--color-surface-800, #0f172a)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 16, overflow: "hidden",
        width: "min(90vw, 420px)", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
      }}>
        {/* Header */}
        <div style={{
          padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <p style={{ fontSize: "0.9rem", fontWeight: 600, color: "#e2e8f0" }}>Crop photo</p>
          <button
            onClick={onCancel}
            style={{ all: "unset", cursor: "pointer", color: "#64748b", lineHeight: 1 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* react-easy-crop viewport */}
        <div style={{ position: "relative", width: "100%", height: 360, background: "#020617" }}>
          <Cropper
            image={picked.objectUrl}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            minZoom={1}
            maxZoom={4}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            style={{
              containerStyle: { background: "#020617" },
              cropAreaStyle: {
                border: "2px solid rgba(255,255,255,0.6)",
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
              },
            }}
          />
        </div>

        {/* Controls row: zoom slider + action buttons */}
        <div style={{
          padding: "12px 20px 8px",
          background: "var(--color-surface-800, #0f172a)",
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          {/* Zoom slider */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ImageIcon size={13} color="#475569" />
            <input
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              style={{ flex: 1, accentColor: "#818cf8", cursor: "pointer" }}
            />
            <ImageIcon size={20} color="#64748b" />
          </div>
          {/* Action buttons below slider */}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={handleRotate}
              title="Rotate 90°"
              style={{
                all: "unset", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 12px", borderRadius: 8,
                fontSize: "0.78rem", color: "#94a3b8",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <RotateCw size={13} /> Rotate
            </button>
            <button
              onClick={handleReset}
              disabled={zoom === 1 && rotation === 0 && crop.x === 0 && crop.y === 0}
              title="Reset to original view"
              style={{
                all: "unset", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 12px", borderRadius: 8,
                fontSize: "0.78rem", color: "#94a3b8",
                border: "1px solid rgba(255,255,255,0.08)",
                opacity: (zoom === 1 && rotation === 0 && crop.x === 0 && crop.y === 0) ? 0.4 : 1,
              }}
            >
              Reset
            </button>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: "16px 24px",
          display: "flex", gap: 8, justifyContent: "flex-end",
          background: "var(--color-surface-800, #0f172a)",
        }}>
          <button
            onClick={onCancel}
            style={{
              all: "unset", cursor: "pointer",
              padding: "8px 16px", borderRadius: 8,
              fontSize: "0.84rem", color: "#94a3b8",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => { void handleConfirm(); }}
            style={{
              all: "unset", cursor: "pointer",
              padding: "8px 18px", borderRadius: 8,
              fontSize: "0.84rem", fontWeight: 600,
              background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
              color: "#fff",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <Check size={13} /> Apply
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AvatarUpload({
  src,
  name,
  size = 64,
  uploadUrl,
  onSuccess,
  onError,
}: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [uploading, setUploading] = useState(false);

  const currentSrc = preview ?? src;

  // Clean up object URLs on unmount
  useEffect(() => () => {
    if (picked) URL.revokeObjectURL(picked.objectUrl);
  }, [picked]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
    if (!ALLOWED.includes(file.type)) {
      onError?.("Only JPEG, PNG and WebP images are accepted");
      return;
    }
    // Generous pre-check — the crop output will be much smaller anyway
    if (file.size > 20 * 1024 * 1024) {
      onError?.("Source image must be under 20 MB");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setPicked({ objectUrl, naturalW: img.naturalWidth, naturalH: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      onError?.("Could not read image file");
    };
    img.src = objectUrl;

    // Reset input immediately so the same file can be re-selected
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleCropConfirm = async (blob: Blob) => {
    // Show optimistic preview immediately (before upload round-trip)
    const objectUrl = URL.createObjectURL(blob);
    setPreview(objectUrl);
    setPicked(null);
    setUploading(true);

    try {
      const fd = new FormData();
      fd.append("avatar", blob, "avatar.webp"); // 256×256 WebP — CDN generates sm/md variants lazily

      const res = await fetch(uploadUrl, {
        method: "POST",
        credentials: "include",
        body: fd,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Upload failed (${res.status})`);
      }

      const { imageUrl } = await res.json() as { imageUrl: string };
      URL.revokeObjectURL(objectUrl);
      setPreview(imageUrl);
      onSuccess(imageUrl);
    } catch (err: unknown) {
      URL.revokeObjectURL(objectUrl);
      setPreview(null);
      onError?.(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };


  const handleCropCancel = () => {
    if (picked) URL.revokeObjectURL(picked.objectUrl);
    setPicked(null);
  };

  return (
    <>
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={handleFileChange}
        aria-label="Upload avatar"
      />

      {/* Clickable avatar with camera overlay */}
      <button
        type="button"
        onClick={() => !uploading && inputRef.current?.click()}
        title="Change photo"
        style={{
          all: "unset",
          display: "inline-flex",
          cursor: uploading ? "wait" : "pointer",
          borderRadius: "50%",
          position: "relative",
          flexShrink: 0,
        }}
      >
        <UserAvatar src={currentSrc} name={name} size={size} />

        {/* Overlay */}
        <span
          className="avatar-overlay"
          style={{
            position: "absolute", inset: 0, borderRadius: "50%",
            background: uploading ? "rgba(0,0,0,0.55)" : "transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "background 0.18s",
            color: "#fff",
          }}
        >
          {uploading
            ? <Loader2 size={Math.round(size * 0.35)} style={{ animation: "spin 0.8s linear infinite" }} />
            : <Camera size={Math.round(size * 0.35)} className="avatar-cam" style={{ opacity: 0, transition: "opacity 0.15s" }} />
          }
        </span>
      </button>

      {/* Hover CSS */}
      <style>{`
        button:hover .avatar-overlay { background: rgba(0,0,0,0.45) !important; }
        button:hover .avatar-cam { opacity: 1 !important; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* Crop modal — rendered in a portal-like fashion at the bottom of the tree */}
      {picked && (
        <CropModal
          picked={picked}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      )}
    </>
  );
}
