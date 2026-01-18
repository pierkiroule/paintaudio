import { initMic, readBands } from './audio.js'

const DRAW_BASE_DIST = 1.1  // distance devant la caméra
const STROKE_LIFE_MS = 120000

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
    this.target = new THREE.Vector3()
    this.dir = new THREE.Vector3()

    this.drawDist = DRAW_BASE_DIST
    this.maxStrokes = 520
    this.strokes = []
    this.spawnClock = 0

    this.camWorldPos = new THREE.Vector3()
    this.camWorldQuat = new THREE.Quaternion()
    this.dirFwd = new THREE.Vector3()
    this.drawPos = new THREE.Vector3()
    this.jitter = new THREE.Vector3()

    this.brushes = [
      { band: 'low', distance: DRAW_BASE_DIST - 0.35, hueShift: -10, float: 0.06 },
      { band: 'mid', distance: DRAW_BASE_DIST, hueShift: 0, float: 0.05 },
      { band: 'high', distance: DRAW_BASE_DIST + 0.35, hueShift: 18, float: 0.04 }
    ]

    const micBtn = document.getElementById('micBtn')
    micBtn.addEventListener('click', async () => {
      if (this.analyser) return
      const a = await initMic()
      this.analyser = a.analyser
      this.fft = a.fft
      this.status.textContent = 'mic:on'
    })
  },

  _palette(bands, hueShift = 0, energyBoost = 0) {
    const clamp = (val, min, max) => Math.min(max, Math.max(min, val))
    const low = clamp(bands.low, 0, 1)
    const mid = clamp(bands.mid, 0, 1)
    const high = clamp(bands.high, 0, 1)
    const energy = clamp(bands.energy + energyBoost, 0, 1)

    const weight = low + mid + high + 0.0001
    const hue = ((
      24 * (low / weight) +
      140 * (mid / weight) +
      235 * (high / weight)
    ) + hueShift + 360) % 360
    const saturation = 35 + energy * 50
    const lightness = 22 + energy * 25
    const colorObj = new THREE.Color().setHSL(hue / 360, saturation / 100, lightness / 100)
    const emissiveObj = new THREE.Color().setHSL(
      ((hue + 18) % 360) / 360,
      (saturation + 10) / 100,
      (lightness + 8) / 100
    )
    const color = `#${colorObj.getHexString()}`
    const emissive = `#${emissiveObj.getHexString()}`
    const opacity = 0.18 + energy * 0.22
    return { color, emissive, opacity }
  },

  _spawnStroke(pos, size, opacity, color, emissive, lifeMs, floatOffset) {
    if (this.strokes.length >= this.maxStrokes) {
      const old = this.strokes.shift()
      old.parentNode && old.parentNode.removeChild(old)
    }

    const e = document.createElement('a-entity')
    e.setAttribute(
      'geometry',
      'primitive: sphere; radius: 1; segmentsWidth: 18; segmentsHeight: 14'
    )
    e.setAttribute('material', {
      color,
      opacity,
      shader: 'standard',
      roughness: 0.5,
      metalness: 0.15,
      emissive,
      emissiveIntensity: 0.35,
      transparent: true,
      depthWrite: false
    })

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
    e.setAttribute(
      'animation__float',
      `property: position; to: ${pos.x} ${pos.y + floatOffset} ${pos.z}; dir: alternate; dur: ${Math.round(6000 + Math.random() * 6000)}; easing: easeInOutSine; loop: true`
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

    this.target.set(
      nx * 2.2,
      1.6,
      3.2 + nz * 2.2
    )

    this.dir.copy(this.target).sub(this.pos)
    this.vel.multiplyScalar(0.92)
    this.vel.addScaledVector(this.dir, 0.15 * dts)
    this.pos.add(this.vel)
    this.el.object3D.position.copy(this.pos)

    // orientation douce (pas de lookAt brutal)
    this.el.object3D.rotation.y += Math.sin(this.t * 0.1) * 0.0006

    // distance de dessin modulée par l’audio
    this.drawDist = DRAW_BASE_DIST + b.mid * 0.6 - b.low * 0.3
    this.cursor.object3D.position.z = -this.drawDist

    // calcul du point DEVANT la caméra
    const camObj = this.camera?.object3D || this.el.object3D
    camObj.getWorldPosition(this.camWorldPos)
    camObj.getWorldQuaternion(this.camWorldQuat)
    this.dirFwd.set(0, 0, -1).applyQuaternion(this.camWorldQuat)

    const interval = Math.max(70, 200 - b.energy * 130)
    this.spawnClock += dt
    while (this.spawnClock >= interval) {
      this.spawnClock -= interval

      this.brushes.forEach((brush) => {
        const bandEnergy = Math.min(1, b[brush.band] * 1.4 + b.energy * 0.15)
        const paint = this._palette(
          {
            low: brush.band === 'low' ? bandEnergy : b.low * 0.2,
            mid: brush.band === 'mid' ? bandEnergy : b.mid * 0.2,
            high: brush.band === 'high' ? bandEnergy : b.high * 0.2,
            energy: bandEnergy
          },
          brush.hueShift,
          b.energy * 0.1
        )

        const spread = 0.03 + bandEnergy * 0.15
        this.drawPos
          .copy(this.camWorldPos)
          .addScaledVector(this.dirFwd, brush.distance)

        this.jitter.set(
          (Math.random() - 0.5) * spread,
          (Math.random() - 0.5) * spread,
          (Math.random() - 0.5) * spread
        )
        this.drawPos.add(this.jitter)

        const size = 0.035 + bandEnergy * 0.28 + b.energy * 0.12
        const opacity = 0.06 + bandEnergy * 0.22
        this._spawnStroke(
          this.drawPos,
          size,
          opacity,
          paint.color,
          paint.emissive,
          STROKE_LIFE_MS,
          brush.float + bandEnergy * 0.04
        )
      })
    }
  }
})
