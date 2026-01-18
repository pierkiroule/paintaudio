import { initMic, readBands } from './audio.js'
import { AutoProgramManager, BrushManager } from './brushes.js'

const DRAW_BASE_DIST = 1.1

AFRAME.registerComponent('brush-rig', {
  init() {
    this.world = document.getElementById('world')
    this.status = document.getElementById('status')
    this.cursor = document.getElementById('drawCursor')
    this.camera = this.el.querySelector('a-camera')
    this.autoBtn = document.getElementById('autoBtn')

    this.analyser = null
    this.fft = null
    this.t = 0

    this.pos = this.el.object3D.position.clone()
    this.vel = new THREE.Vector3()
    this.target = new THREE.Vector3()
    this.dir = new THREE.Vector3()

    this.camWorldPos = new THREE.Vector3()
    this.camWorldQuat = new THREE.Quaternion()
    this.dirFwd = new THREE.Vector3()
    this.dirRight = new THREE.Vector3()
    this.dirUp = new THREE.Vector3()

    this.drawDist = DRAW_BASE_DIST

    this.brushManager = new BrushManager(this.world)
    this.brushManager.addSlot({
      name: 'center',
      offset: new THREE.Vector3(0, 0, 0),
      distance: DRAW_BASE_DIST,
      type: 'ink'
    })
    this.brushManager.addSlot({
      name: 'left',
      offset: new THREE.Vector3(-0.3, 0.02, 0),
      distance: DRAW_BASE_DIST - 0.25,
      type: 'bubbles'
    })
    this.brushManager.addSlot({
      name: 'right',
      offset: new THREE.Vector3(0.3, -0.02, 0),
      distance: DRAW_BASE_DIST + 0.25,
      type: 'glow'
    })

    this.autoManager = new AutoProgramManager(this.brushManager)
    this.autoManager.applyProgram(0)
    this.autoEnabled = true

    const micBtn = document.getElementById('micBtn')
    micBtn.addEventListener('click', async () => {
      if (this.analyser) return
      const a = await initMic()
      this.analyser = a.analyser
      this.fft = a.fft
      this.status.textContent = 'mic:on'
    })

    if (this.autoBtn) {
      this.autoBtn.addEventListener('click', () => {
        this.autoEnabled = !this.autoEnabled
        this.autoManager.setEnabled(this.autoEnabled)
        this.autoBtn.textContent = this.autoEnabled ? 'AUTO:ON' : 'AUTO:OFF'
      })
    }
  },

  tick(t, dt) {
    const dts = dt * 0.001
    this.t += dts

    const b = (this.analyser && this.fft)
      ? readBands(this.analyser, this.fft)
      : { low: 0, mid: 0, high: 0, energy: 0 }

    if (this.analyser) {
      const program = this.autoEnabled ? ` · ${this.autoManager.getCurrentName()}` : ''
      this.status.textContent = `mic:on ${b.energy.toFixed(2)}${program}`
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
    this.dirRight.set(1, 0, 0).applyQuaternion(this.camWorldQuat)
    this.dirUp.set(0, 1, 0).applyQuaternion(this.camWorldQuat)

    if (this.autoEnabled) {
      this.autoManager.update(dt, b.energy)
    }

    this.brushManager.update(
      b,
      t,
      dt,
      this.camWorldPos,
      this.dirFwd,
      this.dirRight,
      this.dirUp
    )
  }
})
