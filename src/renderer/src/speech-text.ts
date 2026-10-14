/** Splits streamed text into complete sentences, keeping the unfinished tail. */
export function takeSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = []
  const re = /[^.!?\n]*(?:[.!?]+(?=\s)|\n+)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(buffer)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++
      continue
    }
    const s = m[0].trim()
    if (s) sentences.push(s)
    last = re.lastIndex
  }
  return { sentences, rest: buffer.slice(last) }
}

/** Strips markdown so text-to-speech doesn't read out symbols. */
export function toSpeakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' code block omitted. ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const NOISE_PHRASES = new Set([
  'thanks for watching',
  'thank you for watching',
  'please subscribe',
  'subtitles by the amaraorg community',
  'you'
])

/** Speech-to-text models sometimes "hear" these stock phrases in noise. */
export function isLikelyNoise(text: string): boolean {
  const norm = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
  return norm.length === 0 || NOISE_PHRASES.has(norm)
}
