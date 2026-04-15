/**
 * AvatarUpload.tsx — crop tool with pure-black design system tokens.
 */

import { OrgAvatar } from "@/components/OrgAvatar";
import { UserAvatar } from "@/components/UserAvatar";
import { Camera, Check, Image as ImageIcon, Loader2, RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Area } from "react-easy-crop";
import Cropper from "react-easy-crop";

const MAX_OUTPUT_PX = 2048;

interface AvatarUploadProps {
  src: string | null;
  name: string;
  size?: number;
  uploadUrl: string;
  onSuccess: (imageUrl: string) => void;
  onError?: (message: string) => void;
  /** Controls shape and fallback display. Default is "user" (circle). "org" is square. */
  type?: "user" | "org";
}

interface PickedImage {
  objectUrl: string;
  naturalW: number;
  naturalH: number;
}

async function getCroppedImg(imageSrc: string, pixelCrop: Area): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = imageSrc;
  });

  const outSize = Math.round(Math.min(MAX_OUTPUT_PX, pixelCrop.width, pixelCrop.height));
  const canvas = document.createElement("canvas");
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D not available");

  ctx.drawImage(image, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, outSize, outSize);

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
  type = "user",
  onConfirm,
  onCancel,
}: {
  picked: PickedImage;
  type?: "user" | "org";
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const cropAreaRef = useRef<Area | null>(null);

  const handleReset = () => { setCrop({ x: 0, y: 0 }); setZoom(1); setRotation(0); };
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
      // Parent handles errors at upload level
    }
  };

  const isReset = zoom === 1 && rotation === 0 && crop.x === 0 && crop.y === 0;

  return createPortal(
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border-strong)",
        borderRadius: 6, overflow: "hidden",
        width: "min(92vw, 440px)", display: "flex", flexDirection: "column",
        boxShadow: "0 32px 80px rgba(0,0,0,0.75)",
      }}>
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 4, flexShrink: 0,
              background: "var(--color-accent-dim)", border: "1px solid rgba(59,130,246,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Camera size={13} color="var(--color-accent)" />
            </div>
            <p style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--color-text-primary)", fontSize: "0.86rem" }}>Crop photo</p>
          </div>
          <button
            onClick={onCancel}
            className="btn btn-ghost"
            style={{ padding: 5, marginLeft: "auto" }}
          >
            <X size={14} />
          </button>
        </div>

        {/* react-easy-crop viewport */}
        <div style={{ position: "relative", width: "100%", height: 340, background: "#050505" }}>
          <Cropper
            image={picked.objectUrl}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            minZoom={1}
            maxZoom={4}
            aspect={1}
            cropShape={type === "org" ? "rect" : "round"}
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            style={{
              containerStyle: { background: "#050505" },
              cropAreaStyle: {
                border: "2px solid var(--color-accent)",
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
              },
            }}
          />
        </div>

        {/* Controls row */}
        <div style={{
          padding: "12px 18px 10px",
          background: "var(--color-surface-raised)",
          display: "flex", flexDirection: "column", gap: 10,
          borderTop: "1px solid var(--color-border)",
        }}>
          {/* Zoom slider */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ImageIcon size={12} color="var(--color-text-tertiary)" />
            <input
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              style={{ flex: 1, accentColor: "var(--color-accent)", cursor: "pointer" }}
            />
            <ImageIcon size={17} color="var(--color-text-secondary)" />
          </div>
          {/* Action buttons */}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={handleRotate}
              className="btn btn-ghost"
              style={{ fontSize: "0.76rem", padding: "4px 10px" }}
              title="Rotate 90°"
            >
              <RotateCw size={12} /> Rotate
            </button>
            <button
              onClick={handleReset}
              disabled={isReset}
              className="btn btn-ghost"
              style={{ fontSize: "0.76rem", padding: "4px 10px", opacity: isReset ? 0.4 : 1 }}
              title="Reset to original view"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button onClick={onCancel} className="btn btn-ghost">
            Cancel
          </button>
          <button
            onClick={() => { void handleConfirm(); }}
            className="btn btn-primary"
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
  type = "user",
}: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [uploading, setUploading] = useState(false);

  const currentSrc = preview ?? src;

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

    if (inputRef.current) inputRef.current.value = "";
  };

  const handleCropConfirm = async (blob: Blob) => {
    const objectUrl = URL.createObjectURL(blob);
    setPreview(objectUrl);
    setPicked(null);
    setUploading(true);

    try {
      const fd = new FormData();
      fd.append("avatar", blob, "avatar.webp");

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
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={handleFileChange}
        aria-label="Upload avatar"
      />

      <button
        type="button"
        onClick={() => !uploading && inputRef.current?.click()}
        title="Change photo"
        style={{
          all: "unset",
          display: "inline-flex",
          cursor: uploading ? "wait" : "pointer",
          borderRadius: 5,
          position: "relative",
          flexShrink: 0,
        }}
      >
        {type === "org" ? (
          <OrgAvatar logo={currentSrc} name={name} size={size} />
        ) : (
          <UserAvatar src={currentSrc} name={name} size={size} />
        )}

        <span
          className="avatar-overlay"
          style={{
            position: "absolute", inset: 0, borderRadius: 5,
            background: uploading ? "rgba(0,0,0,0.6)" : "transparent",
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

      <style>{`
        button:hover .avatar-overlay { background: rgba(0,0,0,0.5) !important; }
        button:hover .avatar-cam { opacity: 1 !important; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {picked && (
        <CropModal
          picked={picked}
          type={type}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      )}
    </>
  );
}
