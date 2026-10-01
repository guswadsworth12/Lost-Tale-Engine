import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

let settings: Record<string, unknown> = {}
vi.mock('@/lib/store/useSettingsStore', () => {
  const useSettingsStore = Object.assign((select?: (s: unknown) => unknown) => (select ? select(settings) : settings), { getState: () => settings, subscribe: () => () => {} })
  return { useSettingsStore }
})

const { ImageGenerateDialog, withReferenceNames } = await import('./GenerateImageButton')

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

  it('sends several people\'s images, at most three, named in the prompt in order', () => {
    const four = ['Bea', 'Cole', 'Wren', 'Ash'].map((name) => ({ url: `/avatars/${name}.png`, name }))
    expect(render('gemini-image', '', { purpose: 'cg', referenceImage: undefined, references: four })).toContain('Sends the first 3 of their 4 images as references, named in the prompt.')
    expect(render('gemini-image', '', { purpose: 'cg', referenceImage: undefined, references: four.slice(0, 2) })).toContain('Sends their 2 images as references, named in the prompt.')
    expect(withReferenceNames('Two pilots on a pier.', four.slice(0, 2))).toBe('Two pilots on a pier. Reference images, in order: Bea, Cole.')
    expect(withReferenceNames('Bea on a pier.', four.slice(0, 1))).toBe('Bea on a pier. Reference image: Bea.')
    // An unnamed image can't be matched to anyone, so none are named.
    expect(withReferenceNames('A pier.', [{ url: '/a.png' }])).toBe('A pier.')
  })
})
