let ctx = null
let lastEnergy = 0

export async function initMic() {
  ctx = new (window.AudioContext || window.webkitAudioContext)()
  if (ctx.state !== 'running') await ctx.resume()

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  })

  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.85

  const fft = new Uint8Array(analyser.frequencyBinCount)
  ctx.createMediaStreamSource(stream).connect(analyser)

  return { analyser, fft }
}

function avg(arr, a, b) {
  let s = 0
  for (let i = a | 0; i < b | 0; i++) s += arr[i]
  return (s / (b - a)) / 255
}

export function readBands(analyser, fft) {
  analyser.getByteFrequencyData(fft)
  const n = fft.length

  const low = avg(fft, 0, n * 0.2)
  const mid = avg(fft, n * 0.2, n * 0.6)
  const high = avg(fft, n * 0.6, n)

  const raw = Math.min(1, low * 0.55 + mid * 1.0 + high * 0.35)
  const energy = lastEnergy = lastEnergy * 0.85 + raw * 0.15

  return { low, mid, high, energy }
}