import type { ComponentProps, ReactNode, RefObject } from 'react'
import { MessageLog } from './MessageLog'
import { VNStage } from './VNStage'

interface ClassicChatViewProps {
  scrollRef: RefObject<HTMLDivElement>
  log: ComponentProps<typeof MessageLog>
  portrait?: ReactNode
  choices?: ReactNode
  hud?: ReactNode
  assist?: ReactNode
  composer: ReactNode
}

export function ClassicChatView({ scrollRef, log, portrait, choices, hud, assist, composer }: ClassicChatViewProps) {
  return <>
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} className="h-full overflow-y-auto px-6 py-6"><MessageLog {...log} /></div>
      {portrait}
    </div>
    {choices}
    {hud}
    {assist}
    {composer}
  </>
}

export function VisualNovelView(props: ComponentProps<typeof VNStage>) {
  return <VNStage {...props} />
}

export function PlaySession({
  visualNovel,
  classic,
  vn,
  storyPanel,
}: {
  visualNovel: boolean
  classic: ClassicChatViewProps
  vn: ComponentProps<typeof VNStage>
  storyPanel?: ReactNode
}) {
  return <div className="flex min-h-0 min-w-0 flex-1">
    <div className="relative flex min-w-0 flex-1 flex-col overflow-clip">
      {visualNovel ? <VisualNovelView {...vn} /> : <ClassicChatView {...classic} />}
    </div>
    {storyPanel}
  </div>
}
