import { initMic, readBands } from './audio.js'

const DRAW_BASE_DIST = 1.1  // distance devant la caméra
const STROKE_LIFE_MS = 90000

AFRAME.registerComponent('brush-rig', {
  init() {
    this.world = document.getElementById('world')
    this.status = document.getElementById('status')
    this.cursor = document.getElementById('drawCursor')
    this.camera = this.el.querySelector('a-camera')

    this.analyser = null
    this.fft = null
    this.t = 0

    this.pos = this.el.object3D.position.clone()
    this.vel = new THREE.Vector3()

    this.drawDist = DRAW_BASE_DIST
    this.maxStrokes = 420
    this.strokes = []

    const micBtn = document.getElementById('micBtn')
    micBtn.addEventListener('click', async () => {
      if (this.analyser) return
      const a = await initMic()
      this.analyser = a.analyser
      this.fft = a.fft
      this.status.textContent = 'mic:on'
    })
  },

  _palette(bands) {
    const clamp = (val, min, max) => Math.min(max, Math.max(min, val))
    const low = clamp(bands.low, 0, 1)
    const mid = clamp(bands.mid, 0, 1)
    const high = clamp(bands.high, 0, 1)
    const energy = clamp(bands.energy, 0, 1)

    const weight = low + mid + high + 0.0001
    const hue = (
      24 * (low / weight) +
      140 * (mid / weight) +
      235 * (high / weight)
    )
    const saturation = 35 + energy * 50
    const lightness = 22 + energy * 25
    const emissive = `hsl(${(hue + 18) % 360} ${saturation + 10}% ${lightness + 8}%)`
    const color = `hsl(${hue} ${saturation}% ${lightness}%)`
    const opacity = 0.18 + energy * 0.22
    return { color, emissive, opacity }
  },

  _spawnStroke(pos, size, opacity, color, emissive, lifeMs) {
    if (this.strokes.length >= this.maxStrokes) {
      const old = this.strokes.shift()
      old.parentNode && old.parentNode.removeChild(old)
    }

    const e = document.createElement('a-entity')
    e.setAttribute(
      'geometry',
      'primitive: sphere; radius: 1; segmentsWidth: 14; segmentsHeight: 10'
    )
    e.setAttribute('material', `
      color: ${color};
      opacity: ${opacity};
      shader: standard;
      roughness: 0.5;
      metalness: 0.15;
      emissive: ${emissive};
      emissiveIntensity: 0.35;
      transparent: true;
      depthWrite: false
    `)

    e.object3D.position.copy(pos)
    e.object3D.scale.setScalar(size)
    e.object3D.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    )

    e.setAttribute(
      'animation__dry',
      `property: material.opacity; to: 0.12; dur: ${lifeMs}; easing: easeOutQuad`
    )

    this.world.appendChild(e)
    this.strokes.push(e)
  },

  tick(t, dt) {
    const dts = dt * 0.001
    this.t += dts

    const b = (this.analyser && this.fft)
      ? readBands(this.analyser, this.fft)
      : { low: 0, mid: 0, high: 0, energy: 0 }

    if (this.analyser) {
      this.status.textContent = `mic:on ${b.energy.toFixed(2)}`
    }

    // mouvement caméra lent et stable
    const nx = Math.sin(this.t * 0.15)
    const nz = Math.cos(this.t * 0.18)

    const target = new THREE.Vector3(
      nx * 2.2,
      1.6,
      3.2 + nz * 2.2
    )

    const dir = target.clone().sub(this.pos)
    this.vel.multiplyScalar(0.92)
    this.vel.addScaledVector(dir, 0.15 * dts)
    this.pos.add(this.vel)
    this.el.object3D.position.copy(this.pos)

    // orientation douce (pas de lookAt brutal)
    this.el.object3D.rotation.y += Math.sin(this.t * 0.1) * 0.0006

    // distance de dessin modulée par l’audio
    this.drawDist = DRAW_BASE_DIST + b.mid * 0.6 - b.low * 0.3
    this.cursor.object3D.position.z = -this.drawDist

    // calcul du point DEVANT la caméra
    if (b.energy > 0.03) {
      const camObj = this.camera?.object3D || this.el.object3D
      const camWorldPos = new THREE.Vector3()
      const camWorldQuat = new THREE.Quaternion()
      camObj.getWorldPosition(camWorldPos)
      camObj.getWorldQuaternion(camWorldQuat)
      const dirFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camWorldQuat)
      const drawPos = camWorldPos.add(dirFwd.multiplyScalar(this.drawDist))
      const spread = 0.05 + b.energy * 0.2
      drawPos.add(
        new THREE.Vector3(
          (Math.random() - 0.5) * spread,
          (Math.random() - 0.5) * spread,
          (Math.random() - 0.5) * spread
        )
      )

      // dépôts parcimonieux
      if (Math.sin(this.t * 2.4 + b.energy * 6.0) > 0.4) {
        const paint = this._palette(b)
        const size = 0.08 + b.energy * 0.32 + b.low * 0.12
        this._spawnStroke(
          drawPos,
          size,
          paint.opacity,
          paint.color,
          paint.emissive,
          STROKE_LIFE_MS
        )
      }
    }
  }
})
