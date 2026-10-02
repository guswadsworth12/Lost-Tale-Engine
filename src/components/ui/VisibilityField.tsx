import { SelectField } from '@/components/ui/Field'
import { useAuthStore } from '@/lib/accounts/useAuthStore'
import type { Visibility } from '@/lib/packs/contract'
import { mayChangeVisibility } from '@/lib/packs/ui'

/**
 * Who can see a world, character, or world-info book. Private unless its owner shares it: something
 * new is its maker's to decide, an existing one only its owner's (`server/ownership.ts`).
 */
export function VisibilityField({ value, row, onChange }: {
  value: Visibility
  /** The saved record, or undefined while it's being created. */
  row: { ownerUserId?: string } | undefined
  onChange: (value: Visibility) => void
}) {
  const user = useAuthStore((s) => s.user)
  const editable = !row || mayChangeVisibility(row, user)
  return <SelectField label="Who can see this" value={value} disabled={!editable}
    hint={editable ? 'Your stories are always yours alone. Sharing lets everyone signed in to this server use it in their own stories.' : 'Only its owner can change this.'}
    onChange={(e) => onChange(e.target.value as Visibility)}>
    <option value="private">Only me</option>
    <option value="shared">Everyone signed in</option>
  </SelectField>
}
