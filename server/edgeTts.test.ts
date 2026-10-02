import { Readable } from 'node:stream'
import { beforeEach, expect, it, vi } from 'vitest'

const tts = vi.hoisted(() => ({
  setMetadata: vi.fn(async () => {}),
  toStream: vi.fn(() => ({ audioStream: Readable.from([Buffer.from('ID3'), Buffer.from('mp3')]) })),
  getVoices: vi.fn(async () => [
    { ShortName: 'en-US-AriaNeural', FriendlyName: 'Microsoft Aria Online (Natural) - English (United States)', Locale: 'en-US', Gender: 'Female' },
    { ShortName: 'de-DE-KatjaNeural', FriendlyName: 'Microsoft Katja Online (Natural) - German (Germany)', Locale: 'de-DE', Gender: 'Female' },
  ]),
  close: vi.fn(),
}))

vi.mock('msedge-tts', () => ({
  MsEdgeTTS: vi.fn(() => tts),
  OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'audio-24khz-48kbitrate-mono-mp3' },
}))

import { edgeSpeak, edgeVoices } from './edgeTts'

beforeEach(() => vi.clearAllMocks())

it('speaks the line in the chosen voice and speed as MP3, with markup escaped', async () => {
  const { audio, contentType } = await edgeSpeak({ text: ' <Hi> & bye ', voice: 'en-GB-SoniaNeural', speed: 1.25 })
  expect(contentType).toBe('audio/mpeg')
  expect(audio.toString()).toBe('ID3mp3')
  expect(tts.setMetadata).toHaveBeenCalledWith('en-GB-SoniaNeural', 'audio-24khz-48kbitrate-mono-mp3')
  expect(tts.toStream).toHaveBeenCalledWith('&lt;Hi&gt; &amp; bye', { rate: 1.25 })
  expect(tts.close).toHaveBeenCalled()
})

it('falls back to a default voice and normal speed for anything that isn\'t one', async () => {
  await edgeSpeak({ text: 'Hi', voice: '"><script>', speed: 9 })
  expect(tts.setMetadata).toHaveBeenCalledWith('en-US-AriaNeural', expect.anything())
  expect(tts.toStream).toHaveBeenCalledWith('Hi', undefined)
})

it('refuses empty text without reaching Microsoft', async () => {
  await expect(edgeSpeak({ text: '   ' })).rejects.toMatchObject({ status: 400 })
  expect(tts.setMetadata).not.toHaveBeenCalled()
})

it('closes the connection when the listener goes away', async () => {
  const controller = new AbortController()
  tts.toStream.mockReturnValueOnce({ audioStream: Readable.from((async function* () { controller.abort(); yield Buffer.from('x') })()) })
  await edgeSpeak({ text: 'Hi' }, controller.signal)
  expect(tts.close).toHaveBeenCalled()
})

it('reports a failure as a gateway error', async () => {
  tts.setMetadata.mockRejectedValueOnce(new Error('socket hang up'))
  await expect(edgeSpeak({ text: 'Hi' })).rejects.toMatchObject({ status: 502, message: expect.stringContaining('socket hang up') })
})

it('lists voices by language with short names', async () => {
  const voices = await edgeVoices()
  expect(voices).toEqual([
    { id: 'de-DE-KatjaNeural', label: 'Katja', locale: 'de-DE', gender: 'Female' },
    { id: 'en-US-AriaNeural', label: 'Aria', locale: 'en-US', gender: 'Female' },
  ])
  // Kept for a day: the second ask doesn't reach Microsoft.
  await edgeVoices()
  expect(tts.getVoices).toHaveBeenCalledTimes(1)
})
