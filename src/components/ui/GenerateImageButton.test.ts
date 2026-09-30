import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

let settings: Record<string, unknown> = {}
vi.mock('@/lib/store/useSettingsStore', () => {
  const useSettingsStore = Object.assign((select?: (s: unknown) => unknown) => (select ? select(settings) : settings), { getState: () => settings, subscribe: () => () => {} })
  return { useSettingsStore }
})

const { ImageGenerateDialog } = await import('./GenerateImageButton')

const render = (backend: string, model: string, props: Partial<Parameters<typeof ImageGenerateDialog>[0]> = {}) => {
  settings = { imageBackend: backend, imageBackendModel: model, imageBackendBaseUrl: '', imageBackendUsername: '', imageBackendQuality: '' }
  return renderToStaticMarkup(createElement(ImageGenerateDialog, { purpose: 'sprite', initialPrompt: 'Bea, smiling', referenceImage: '/avatars/bea.png', onUse: () => {}, onClose: () => {}, ...props }))
}

describe('ImageGenerateDialog', () => {
  it('offers a transparent sprite and her look when the model can do both', () => {
    const html = render('openai-image', 'gpt-image-1')
    expect(html).toContain('Transparent background')
    expect(html).not.toContain('can&#x27;t make transparent images')
    expect(html).toContain('Sends their current image as a reference.')
    expect(html).toContain('Sends to OpenAI (hosted).')
  })

  it('says what the model can\'t do instead of dropping it', () => {
    const dalle = render('openai-image', 'dall-e-3')
    expect(dalle).toContain('can&#x27;t make transparent images. It will be asked for a plain background instead.')
    expect(dalle).toContain('can&#x27;t take a reference image')
    expect(render('gemini-image', '')).toContain('can&#x27;t make transparent images')
    // A local backend declares nothing: the same notes, and nothing breaks.
    expect(render('a1111', '')).toContain('can&#x27;t take a reference image')
  })

  it('shows the transparency choice only on a sprite slot', () => {
    expect(render('openai-image', 'gpt-image-1', { purpose: 'background', referenceImage: undefined })).not.toContain('Transparent background')
  })
})
