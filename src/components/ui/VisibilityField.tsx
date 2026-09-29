import { SelectField } from '@/components/ui/Field'
import { useAuthStore } from '@/lib/accounts/useAuthStore'
import type { Visibility } from '@/lib/packs/contract'
import { mayChangeVisibility } from '@/lib/packs/ui'

/**
 * Who can see a world, character, or world-info book. Something new is its maker's to decide; an
 * existing one only its owner's (the server enforces the same rule, `server/ownership.ts`).
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
    hint={editable ? 'Only me keeps it, and any story using it, out of everyone else’s library.' : 'Only its owner can change this.'}
    onChange={(e) => onChange(e.target.value as Visibility)}>
    <option value="shared">Everyone signed in</option>
    <option value="private">Only me</option>
  </SelectField>
}
