import { parseHelpInline } from '@/lib/help/helpContent'

/** Renders help copy, turning `**label**` into a bold control name. */
export function HelpText({ text }: { text: string }) {
  return (
    <>
      {parseHelpInline(text).map((run, index) =>
        run.strong ? (
          <strong key={index} className="font-semibold text-text">
            {run.text}
          </strong>
        ) : (
          <span key={index}>{run.text}</span>
        ),
      )}
    </>
  )
}
