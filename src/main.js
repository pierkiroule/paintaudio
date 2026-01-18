// pinceau fixe (coord écran)
const brush = { x: 0.5, y: 0.5 }

// paramètres papier
let paperY = 0
let paperRot = 0
let drift = 0

function loop() {
  requestAnimationFrame(loop)

  const b = audio ? audio() : { energy: 0, low: 0, high: 0 }

  // 🧾 papier qui défile
  paperY += 0.001 + b.energy * 0.01

  // 🌀 rotation douce
  paperRot = Math.sin(performance.now() * 0.0002) * (0.02 + b.high * 0.05)

  // 🌬️ respiration
  drift = Math.sin(performance.now() * 0.0001) * (0.01 + b.low * 0.03)

  paperMesh.position.y = paperY
  paperMesh.rotation.z = paperRot

  // 🖋️ dépôt d'encre AU CENTRE
  if (b.energy > 0.02) {
    roll.addStroke({
      xNorm: (Math.random() - 0.5) * 0.02, // quasi fixe
      amp: b.energy
    })
  }

  render()
}