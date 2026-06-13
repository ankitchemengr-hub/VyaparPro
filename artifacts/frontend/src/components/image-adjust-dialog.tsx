import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, RotateCcw } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  src: string;
  onConfirm: (dataUrl: string) => void;
};

const SIZE_OPTIONS = [
  { label: "Small (400 × 400)", value: 400 },
  { label: "Medium (600 × 600)", value: 600 },
  { label: "Large (800 × 800)", value: 800 },
  { label: "Extra Large (1000 × 1000)", value: 1000 },
];

const VIEW_SIZE = 320; // px on screen for the crop frame

export function ImageAdjustDialog({ open, onOpenChange, src, onConfirm }: Props) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [naturalW, setNaturalW] = useState(1);
  const [naturalH, setNaturalH] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [outputSize, setOutputSize] = useState(800);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // Compute "cover" base scale so the image fully fills the crop frame at zoom=1.
  const baseScale = imgLoaded
    ? Math.max(VIEW_SIZE / naturalW, VIEW_SIZE / naturalH)
    : 1;
  const scale = baseScale * zoom;
  const drawW = naturalW * scale;
  const drawH = naturalH * scale;

  // Reset state whenever a new image is loaded.
  useEffect(() => {
    if (!open) return;
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setImgLoaded(false);
  }, [open, src]);

  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const el = e.currentTarget;
    setNaturalW(el.naturalWidth);
    setNaturalH(el.naturalHeight);
    setImgLoaded(true);
  };

  // Clamp offset so image always covers the crop frame.
  const clampOffset = (x: number, y: number, dw: number, dh: number) => {
    const maxX = Math.max(0, (dw - VIEW_SIZE) / 2);
    const maxY = Math.max(0, (dh - VIEW_SIZE) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setOffset(clampOffset(dragRef.current.ox + dx, dragRef.current.oy + dy, drawW, drawH));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    dragRef.current = null;
  };

  // Re-clamp when zoom changes.
  useEffect(() => {
    if (!imgLoaded) return;
    setOffset((o) => clampOffset(o.x, o.y, drawW, drawH));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, imgLoaded]);

  const handleReset = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const handleConfirm = () => {
    if (!imgRef.current) return;
    // Map view coordinates back to natural image coordinates.
    // The visible center of the image in view coords is (VIEW_SIZE/2 + offset).
    // We need the natural-pixel rectangle of size VIEW_SIZE/scale centered at (-offset/scale + natural-center).
    const naturalCropSize = VIEW_SIZE / scale;
    const cx = naturalW / 2 - offset.x / scale;
    const cy = naturalH / 2 - offset.y / scale;
    const sx = Math.max(0, cx - naturalCropSize / 2);
    const sy = Math.max(0, cy - naturalCropSize / 2);
    const sSize = Math.min(naturalCropSize, naturalW - sx, naturalH - sy);

    const canvas = document.createElement("canvas");
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outputSize, outputSize);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(imgRef.current, sx, sy, sSize, sSize, 0, 0, outputSize, outputSize);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    onConfirm(dataUrl);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust Image</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Drag to reposition, use the slider to zoom in or out, then choose a size.
          </p>

          <div
            ref={containerRef}
            className="relative mx-auto bg-muted/40 overflow-hidden rounded-md cursor-grab active:cursor-grabbing touch-none select-none"
            style={{ width: VIEW_SIZE, height: VIEW_SIZE }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {/* Image, drawn larger than frame; centered + offset */}
            <img
              ref={imgRef}
              src={src}
              alt="Adjust"
              onLoad={onImgLoad}
              draggable={false}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: drawW,
                height: drawH,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                userSelect: "none",
                pointerEvents: "none",
              }}
            />
            {/* Grid overlay */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(0,0,0,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.15) 1px, transparent 1px)",
                backgroundSize: `${VIEW_SIZE / 3}px ${VIEW_SIZE / 3}px`,
              }}
            />
            <div className="absolute inset-0 ring-2 ring-primary/60 pointer-events-none rounded-md" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Zoom</Label>
              <button
                type="button"
                onClick={handleReset}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" /> Reset
              </button>
            </div>
            <Slider
              min={1}
              max={3}
              step={0.05}
              value={[zoom]}
              onValueChange={([v]) => setZoom(v)}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Output Size</Label>
            <Select value={String(outputSize)} onValueChange={(v) => setOutputSize(Number(v))}>
              <SelectTrigger data-testid="select-output-size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIZE_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={String(s.value)}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Saved as a {outputSize}×{outputSize} JPEG.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!imgLoaded} data-testid="button-confirm-image">
            <Check className="w-4 h-4 mr-1" />
            Save Image
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
