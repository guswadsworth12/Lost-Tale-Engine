import type { RomanceEmphasis } from '@/lib/world/worldTemplates'

/** Prompt gates shared by every speaker in a world. An active scene keeps its own continuity and content rules. */
export function romancePromptPolicy(emphasis: RomanceEmphasis, sceneActive: boolean, playerEscalated: boolean, fadeToBlack = false) {
  const allowed = emphasis !== 'off'
  const proactive = emphasis === 'focus'
  return {
    proactive,
    intimacyOptions: allowed && (proactive || sceneActive),
    intimacyContent: allowed && (proactive || sceneActive || playerEscalated || fadeToBlack),
    naturalGuidance: emphasis === 'natural'
      ? "Romance may develop from the characters and their shared history when the player invites it. Let the current story, each character's goals, and their connections with everyone present lead this scene; do not steer an ordinary exchange toward dating or intimacy."
      : '',
  }
}
