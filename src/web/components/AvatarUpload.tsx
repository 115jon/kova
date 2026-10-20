/**
 * AvatarUpload.tsx — avatar picker with a crop dialog.
 */

import { Modal, ModalHeader } from "@/components/Modal";
import { OrgAvatar } from "@/components/OrgAvatar";
import { UserAvatar } from "@/components/UserAvatar";
import { Camera, Check, Image as ImageIcon, Loader2, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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

  return (
    <Modal onClose={onCancel} maxWidth={440}>
      <ModalHeader
        title="Crop photo"
        icon={<span className="icon-tile" aria-hidden="true"><Camera /></span>}
      />

      {/* react-easy-crop viewport */}
      <div style={{ position: "relative", width: "100%", height: 340, marginTop: "var(--space-5)", background: "var(--color-surface-raised)" }}>
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
            containerStyle: { background: "var(--color-surface-raised)" },
            cropAreaStyle: {
              border: "2px solid var(--color-accent)",
              boxShadow: "0 0 0 9999px var(--color-overlay)",
            },
          }}
        />
      </div>

      {/* Controls row */}
      <div className="stack-sm" style={{
        padding: "var(--space-3) var(--space-6)",
        borderBlockStart: "1px solid var(--color-border)",
      }}>
        {/* Zoom slider */}
        <div className="row">
          <ImageIcon size={14} aria-hidden="true" style={{ color: "var(--color-text-tertiary)" }} />
          <input
            type="range"
            aria-label="Zoom"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            style={{ flex: 1, width: "auto", accentColor: "var(--color-accent-solid)", cursor: "pointer" }}
          />
          <ImageIcon size={18} aria-hidden="true" style={{ color: "var(--color-text-secondary)" }} />
        </div>
        {/* Action buttons */}
        <div className="row">
          <button
            type="button"
            onClick={handleRotate}
            className="btn btn-secondary btn-sm"
            title="Rotate 90°"
          >
            <RotateCw /> Rotate
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={isReset}
            className="btn btn-secondary btn-sm"
            title="Reset to original view"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="modal-footer">
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => { void handleConfirm(); }}
          className="btn btn-primary"
        >
          <Check /> Apply
        </button>
      </div>
    </Modal>
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
        className="avatar-upload"
        data-shape={type}
        data-uploading={uploading || undefined}
        onClick={() => !uploading && inputRef.current?.click()}
        title="Change photo"
        aria-label="Change photo"
      >
        {type === "org" ? (
          <OrgAvatar logo={currentSrc} name={name} size={size} />
        ) : (
          <UserAvatar src={currentSrc} name={name} size={size} />
        )}

        <span className="avatar-upload-overlay" aria-hidden="true">
          {uploading
            ? <Loader2 className="spin" size={Math.round(size * 0.35)} />
            : <Camera className="avatar-upload-cam" size={Math.round(size * 0.35)} />
          }
        </span>
      </button>

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
