export function createRoll({ w = 1024, h = 4096 } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')

  let writeY = 0
  let viewTop = 0
  let mode = 'live'

  function noise(x, y) {
    return (Math.sin(x * 12.989 + y * 78.233) * 43758.5453) % 1
  }

  function drawPaper() {
    const img = ctx.getImageData(0, 0, w, h)
    const d = img.data
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4
        const v = 242 + noise(x, y) * 8
        d[i] = d[i + 1] = d[i + 2] = v
        d[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }

  drawPaper()

  function blot(x, y, r, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(0,0,0,${a})`)
    g.addColorStop(0.4, `rgba(0,0,0,${a * 0.4})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  function addStroke({ xNorm, amp }) {
    if (mode !== 'live') return

    const x = w * (0.5 + xNorm * 0.45)
    const y = writeY

    blot(x, y, 18 + amp * 40, 0.15 + amp * 0.25)

    writeY += 4 + amp * 10
    if (writeY > h - 10) writeY = 0
  }

  function setView(u, windowH) {
    const maxTop = Math.max(0, h - windowH)
    viewTop = maxTop * (1 - u)
  }

  return {
    canvas,
    ctx,
    get writeY() { return writeY },
    get viewTop() { return viewTop },
    set mode(v) { mode = v },
    addStroke,
    setView
  }
}