// Forwards raw mono samples to the page in ~128 ms batches.
class PcmTap extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(2048)
    this.length = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) {
      if (this.length + channel.length > this.buffer.length) this.flush()
      this.buffer.set(channel, this.length)
      this.length += channel.length
      if (this.length >= this.buffer.length) this.flush()
    }
    return true
  }

  flush() {
    if (this.length === 0) return
    this.port.postMessage(this.buffer.slice(0, this.length))
    this.length = 0
  }
}

registerProcessor('pcm-tap', PcmTap)
