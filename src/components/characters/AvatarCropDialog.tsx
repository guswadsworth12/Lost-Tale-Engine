import { useRef, useState, type PointerEvent } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

const VIEW_SIZE = 256
const OUTPUT_SIZE = 512

export function AvatarCropDialog({
  source,
  onApply,
  onClose,
}: {
  source: string
  onApply: (dataUrl: string) => void
  onClose: () => void
}) {
  const imageRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  const scale = size.width && size.height ? Math.max(VIEW_SIZE / size.width, VIEW_SIZE / size.height) * zoom : 1
  const width = size.width * scale
  const height = size.height * scale
  const clamp = (x: number, y: number, nextZoom = zoom) => {
    const factor = zoom ? nextZoom / zoom : 1
    return {
      x: Math.max((VIEW_SIZE - width * factor) / 2, Math.min((width * factor - VIEW_SIZE) / 2, x)),
      y: Math.max((VIEW_SIZE - height * factor) / 2, Math.min((height * factor - VIEW_SIZE) / 2, y)),
    }
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    setOffset(clamp(
      dragRef.current.offsetX + event.clientX - dragRef.current.x,
      dragRef.current.offsetY + event.clientY - dragRef.current.y,
    ))
  }

  const apply = () => {
    const image = imageRef.current
    if (!image?.naturalWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = OUTPUT_SIZE
    const context = canvas.getContext('2d')
    if (!context) return
    context.imageSmoothingQuality = 'high'
    const ratio = OUTPUT_SIZE / VIEW_SIZE
    context.drawImage(
      image,
      (VIEW_SIZE / 2 + offset.x - width / 2) * ratio,
      (VIEW_SIZE / 2 + offset.y - height / 2) * ratio,
      width * ratio,
      height * ratio,
    )
    onApply(canvas.toDataURL('image/png'))
  }

  return (
    <Modal onClose={onClose} title="Crop character avatar" description="Drag or use arrow keys to frame the face. Adjust the zoom, then save the character after applying the crop." size="md">
      <div
        className="relative mx-auto h-64 w-64 touch-none cursor-grab overflow-hidden rounded-xl border border-border bg-bg-sunken active:cursor-grabbing"
        role="group"
        tabIndex={0}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          dragRef.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y }
        }}
        onPointerMove={move}
        onPointerUp={() => { dragRef.current = null }}
        onPointerCancel={() => { dragRef.current = null }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 40 : 10
          const moves: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
          }
          const moveBy = moves[event.key]
          if (!moveBy) return
          event.preventDefault()
          setOffset((current) => clamp(current.x + moveBy[0], current.y + moveBy[1]))
        }}
        aria-label="Avatar crop preview; drag or use arrow keys to reposition"
      >
        <img
          ref={imageRef}
          src={source}
          alt=""
          draggable={false}
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget
            const fit = Math.max(VIEW_SIZE / naturalWidth, VIEW_SIZE / naturalHeight)
            setSize({ width: naturalWidth, height: naturalHeight })
            setOffset({ x: 0, y: Math.max(0, (naturalHeight * fit - VIEW_SIZE) / 4) })
          }}
          className="pointer-events-none absolute max-w-none select-none"
          style={{ width, height, left: (VIEW_SIZE - width) / 2 + offset.x, top: (VIEW_SIZE - height) / 2 + offset.y }}
        />
      </div>
      <label className="mt-5 flex items-center gap-3 text-sm text-text-muted">
        Zoom
        <input
          type="range"
          min="1"
          max="8"
          step="0.01"
          value={zoom}
          onChange={(event) => {
            const nextZoom = Number(event.target.value)
            setOffset(clamp(offset.x, offset.y, nextZoom))
            setZoom(nextZoom)
          }}
          className="w-full accent-accent"
        />
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={apply} disabled={!size.width}>Use crop</Button>
      </div>
    </Modal>
  )
}
