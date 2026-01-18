import { initMic, readBands } from './audio.js'

const DRAW_BASE_DIST = 1.1  // distance devant la caméra

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
    this.maxStrokes = 200
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

  _spawnStroke(pos, size, opacity, color, lifeMs) {
    if (this.strokes.length >= this.maxStrokes) {
      const old = this.strokes.shift()
      old.parentNode && old.parentNode.removeChild(old)
    }

    const e = document.createElement('a-entity')
    e.setAttribute('geometry', 'primitive: icosahedron; radius: 1; detail: 0')
    e.setAttribute('material', `
      color: ${color};
      opacity: ${opacity};
      transparent: true;
      depthWrite: false
    `)

    e.object3D.position.copy(pos)
    e.object3D.scale.setScalar(size)

    e.setAttribute(
      'animation__fade',
      `property: material.opacity; to: 0; dur: ${lifeMs}; easing: easeOutQuad`
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

      // dépôts parcimonieux
      if (Math.sin(this.t * 2.0) > 0.75) {
        if (b.low > 0.06) {
          this._spawnStroke(drawPos, 0.14 + b.low * 0.3, 0.06, '#1b1b1b', 7000)
        }
        if (b.mid > 0.05) {
          this._spawnStroke(drawPos, 0.11 + b.mid * 0.25, 0.05, '#2a2a2a', 6000)
        }
        if (b.high > 0.04) {
          this._spawnStroke(drawPos, 0.08 + b.high * 0.18, 0.04, '#3a3a3a', 5000)
        }
      }
    }
  }
})
